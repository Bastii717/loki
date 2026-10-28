import { sql } from 'drizzle-orm';
import {
	boolean,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	serial,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	type AnyPgColumn
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
	'users',
	{
		id: serial('id').primaryKey(),
		sub: text('sub').notNull().unique(),
		username: text('username').notNull(),
		role: text('role', { enum: ['member', 'moderator', 'admin'] }).notNull(),
		displayName: text('display_name'),
		displayNameKey: text('display_name_key'),
		displayNameChangedAt: timestamp('display_name_changed_at', { withTimezone: true }),
		// null = the member chose the name themselves
		displayNameSetBy: integer('display_name_set_by').references((): AnyPgColumn => users.id),
		avatarKey: text('avatar_key'),
		avatarThumbKey: text('avatar_thumb_key'),
		motto: text('motto').notNull().default(''),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('users_display_name_key_idx')
			.on(t.displayNameKey)
			.where(sql`${t.displayNameKey} IS NOT NULL`),
		// search: people by the name the board shows (pg_trgm, see migration 0010)
		index('users_name_trgm_idx').using(
			'gin',
			sql`(coalesce(${t.displayName}, ${t.username})) gin_trgm_ops`
		)
	]
);

export const sessions = pgTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: createdAt()
});

export const media = pgTable(
	'media',
	{
		id: serial('id').primaryKey(),
		uploaderId: integer('uploader_id')
			.notNull()
			.references(() => users.id),
		title: text('title').notNull().default(''),
		kind: text('kind', { enum: ['image', 'gif', 'video'] }).notNull(),
		objectKey: text('object_key').notNull(),
		thumbKey: text('thumb_key').notNull(),
		width: integer('width'),
		height: integer('height'),
		nsfw: boolean('nsfw').notNull().default(false),
		spoiler: boolean('spoiler').notNull().default(false),
		score: integer('score').notNull().default(0),
		viewCount: integer('view_count').notNull().default(0),
		hotScore: doublePrecision('hot_score').notNull().default(0),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		index('media_hot_score_idx').on(t.hotScore),
		index('media_created_at_idx').on(t.createdAt),
		// /media/[...key] resolves a requested key to its row to enforce under-review
		index('media_object_key_idx').on(t.objectKey),
		index('media_thumb_key_idx').on(t.thumbKey),
		// search: substring and typo matching (pg_trgm, see migration 0010)
		index('media_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`)
	]
);

export const tags = pgTable(
	'tags',
	{
		id: serial('id').primaryKey(),
		name: text('name').notNull().unique()
	},
	(t) => [index('tags_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`)]
);

export const mediaTags = pgTable(
	'media_tags',
	{
		mediaId: integer('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),
		tagId: integer('tag_id')
			.notNull()
			.references(() => tags.id)
	},
	(t) => [primaryKey({ columns: [t.mediaId, t.tagId] })]
);

export const votes = pgTable(
	'votes',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		mediaId: integer('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),
		value: smallint('value').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.mediaId] })]
);

export const favorites = pgTable(
	'favorites',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		mediaId: integer('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [primaryKey({ columns: [t.userId, t.mediaId] })]
);

export const comments = pgTable(
	'comments',
	{
		id: serial('id').primaryKey(),
		mediaId: integer('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		text: text('text').notNull(),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('comments_text_trgm_idx').using('gin', sql`${t.text} gin_trgm_ops`)]
);

export const mediaViews = pgTable(
	'media_views',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		mediaId: integer('media_id')
			.notNull()
			.references(() => media.id, { onDelete: 'cascade' }),
		viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.mediaId] })]
);

export const quotes = pgTable(
	'quotes',
	{
		id: serial('id').primaryKey(),
		text: text('text').notNull(),
		author: text('author').notNull(),
		submittedBy: integer('submitted_by').references(() => users.id, { onDelete: 'set null' }),
		reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [index('quotes_text_trgm_idx').using('gin', sql`${t.text} gin_trgm_ops`)]
);

export const quoteVotes = pgTable(
	'quote_votes',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		quoteId: integer('quote_id')
			.notNull()
			.references(() => quotes.id, { onDelete: 'cascade' }),
		value: smallint('value').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.quoteId] })]
);

export const siteContent = pgTable('site_content', {
	key: text('key', { enum: ['rules', 'faq'] }).primaryKey(),
	markdown: text('markdown').notNull().default(''),
	updatedBy: integer('updated_by').references(() => users.id),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * User reports. contentId deliberately has no foreign key: a report outlives the content it
 * points at (deleted by a mod or its owner), so the excerpt and authorId are snapshots.
 */
export const reports = pgTable(
	'reports',
	{
		id: serial('id').primaryKey(),
		contentType: text('content_type', { enum: ['meme', 'comment', 'quote'] }).notNull(),
		contentId: integer('content_id').notNull(),
		reporterId: integer('reporter_id')
			.notNull()
			.references(() => users.id),
		authorId: integer('author_id')
			.notNull()
			.references(() => users.id),
		category: text('category', {
			enum: ['hurtful', 'disturbing', 'misinformation', 'spam', 'other']
		}).notNull(),
		text: text('text').notNull().default(''),
		excerpt: text('excerpt').notNull(),
		status: text('status', { enum: ['open', 'resolved'] })
			.notNull()
			.default('open'),
		outcome: text('outcome', { enum: ['dismissed', 'actioned', 'removed'] }),
		createdAt: createdAt(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolvedBy: integer('resolved_by').references(() => users.id)
	},
	(t) => [
		index('reports_content_idx').on(t.contentType, t.contentId, t.status),
		index('reports_author_outcome_idx').on(t.authorId, t.outcome),
		// The hot paths (open-count subqueries, queue) only ever look at open reports.
		index('reports_open_content_idx')
			.on(t.contentType, t.contentId)
			.where(sql`${t.status} = 'open'`)
	]
);

export const timeouts = pgTable(
	'timeouts',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		setBy: integer('set_by')
			.notNull()
			.references(() => users.id),
		reason: text('reason').notNull(),
		until: timestamp('until', { withTimezone: true }).notNull(),
		liftedAt: timestamp('lifted_at', { withTimezone: true }),
		liftedBy: integer('lifted_by').references(() => users.id),
		createdAt: createdAt()
	},
	(t) => [index('timeouts_user_until_idx').on(t.userId, t.until)]
);

/** Moderation audit trail. Append-only by convention: nothing updates or deletes rows. */
export const auditLog = pgTable(
	'audit_log',
	{
		id: serial('id').primaryKey(),
		actorId: integer('actor_id')
			.notNull()
			.references(() => users.id),
		action: text('action').notNull(),
		targetType: text('target_type').notNull(),
		targetId: integer('target_id').notNull(),
		detail: text('detail').notNull().default(''),
		createdAt: createdAt()
	},
	(t) => [index('audit_log_created_at_idx').on(t.createdAt)]
);

/** Admin maintenance switch. A single row with id 1; no row means "off". */
export const maintenance = pgTable('maintenance', {
	id: integer('id').primaryKey(),
	enabled: boolean('enabled').notNull().default(false),
	message: text('message').notNull().default(''),
	startsAt: timestamp('starts_at', { withTimezone: true }),
	until: timestamp('until', { withTimezone: true }),
	updatedBy: integer('updated_by').references(() => users.id),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/** Admin seasonal-theme settings. A single row with id 1; no row means mode "auto". */
export const seasonSettings = pgTable('season_settings', {
	id: integer('id').primaryKey(),
	mode: text('mode', { enum: ['auto', 'off', 'forced'] })
		.notNull()
		.default('auto'),
	theme: text('theme'),
	until: timestamp('until', { withTimezone: true }),
	updatedBy: integer('updated_by').references(() => users.id),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

/**
 * In-app notices. contentId deliberately has no foreign key: a notice about deleted content must
 * survive it. mediaId is set only while the meme exists and the notice leads to its page, so
 * deleting the meme takes those notices with it.
 */
export const notifications = pgTable(
	'notifications',
	{
		id: serial('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
		contentType: text('content_type', { enum: ['meme', 'comment', 'quote'] }),
		contentId: integer('content_id'),
		mediaId: integer('media_id').references(() => media.id, { onDelete: 'cascade' }),
		detail: text('detail').notNull().default(''),
		count: integer('count').notNull().default(1),
		readAt: timestamp('read_at', { withTimezone: true }),
		createdAt: createdAt(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		// The bell count only ever looks at unread rows.
		index('notifications_unread_idx')
			.on(t.userId)
			.where(sql`${t.readAt} IS NULL`),
		index('notifications_user_updated_idx').on(t.userId, t.updatedAt.desc())
	]
);

/** Per-member opt-outs for the optional notices. No row means everything is on. */
export const notificationPrefs = pgTable('notification_prefs', {
	userId: integer('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	comments: boolean('comments').notNull().default(true),
	threadComments: boolean('thread_comments').notNull().default(true),
	reportOutcomes: boolean('report_outcomes').notNull().default(true)
});
