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
	timestamp
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	sub: text('sub').notNull().unique(),
	username: text('username').notNull(),
	role: text('role', { enum: ['member', 'moderator', 'admin'] }).notNull(),
	createdAt: createdAt()
});

export const sessions = pgTable('sessions', {
	tokenHash: text('token_hash').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
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
		createdAt: createdAt()
	},
	(t) => [
		index('media_hot_score_idx').on(t.hotScore),
		index('media_created_at_idx').on(t.createdAt)
	]
);

export const tags = pgTable('tags', {
	id: serial('id').primaryKey(),
	name: text('name').notNull().unique()
});

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

export const comments = pgTable('comments', {
	id: serial('id').primaryKey(),
	mediaId: integer('media_id')
		.notNull()
		.references(() => media.id, { onDelete: 'cascade' }),
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	text: text('text').notNull(),
	createdAt: createdAt()
});

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

export const quotes = pgTable('quotes', {
	id: serial('id').primaryKey(),
	text: text('text').notNull(),
	author: text('author').notNull(),
	submittedBy: integer('submitted_by').references(() => users.id, { onDelete: 'set null' }),
	createdAt: createdAt()
});

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
