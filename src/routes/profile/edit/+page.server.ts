import { fail } from '@sveltejs/kit';
import {
	AvatarError,
	avatarErrorMessage,
	removeAvatar,
	setAvatar
} from '../../../lib/server/avatar';
import { TimeoutActiveError } from '../../../lib/server/moderation';
import { timeoutMessage } from '../../../lib/server/moderation-http';
import {
	clearMotto,
	getProfile,
	nextRenameAt,
	normalizeDisplayName,
	normalizeMotto,
	ProfileInputError,
	setDisplayName,
	setMotto
} from '../../../lib/server/profile';
import type { Actions, PageServerLoad } from './$types';

// Reachable while timed out (own avatar removal and motto clearing stay allowed), so there is no
// timeout guard here; the writes that need one raise TimeoutActiveError themselves.
export const load: PageServerLoad = async ({ locals }) => {
	const profile = await getProfile(locals.user!.id);
	return {
		profile: {
			username: profile.username,
			displayName: profile.displayName,
			motto: profile.motto,
			avatarKey: profile.avatarKey,
			avatarThumbKey: profile.avatarThumbKey
		},
		// admins rename without the cooldown (setDisplayName), so the field is never locked for them
		nextRenameAt:
			profile.role === 'admin'
				? null
				: (nextRenameAt(profile.displayNameChangedAt, new Date())?.toISOString() ?? null)
	};
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		const actor = locals.user!;
		const data = await request.formData();
		const displayName = String(data.get('displayName') ?? '');
		const motto = String(data.get('motto') ?? '');
		const avatar = data.get('avatar');
		try {
			const stored = await getProfile(actor.id);
			// An empty field with an existing name keeps it; a disabled field (cooldown) sends nothing.
			const name = normalizeDisplayName(displayName);
			if (name !== '' && name !== (stored.displayName ?? '')) {
				await setDisplayName(actor, actor.id, displayName);
			}
			// Only a real change is written (and audited). Clearing goes through clearMotto, which
			// stays allowed while timed out; setMotto would be refused for a muted member.
			const wanted = normalizeMotto(motto);
			if (wanted !== stored.motto) {
				if (wanted === '') await clearMotto(actor, actor.id);
				else await setMotto(actor, motto);
			}
			// A browser sends an empty file part when none was chosen.
			if (avatar instanceof File && avatar.size > 0) {
				await setAvatar(actor, Buffer.from(await avatar.arrayBuffer()));
			}
		} catch (e) {
			if (e instanceof TimeoutActiveError) {
				return fail(403, { error: timeoutMessage(e), displayName, motto });
			}
			if (e instanceof ProfileInputError)
				return fail(400, { error: e.message, displayName, motto });
			if (e instanceof AvatarError) {
				return fail(400, { error: avatarErrorMessage(e), displayName, motto });
			}
			throw e;
		}
		return { saved: true };
	},

	removeAvatar: async ({ locals }) => {
		const actor = locals.user!;
		try {
			await removeAvatar(actor, actor.id);
		} catch (e) {
			if (e instanceof ProfileInputError) return fail(400, { error: e.message });
			throw e;
		}
		return { removed: true };
	}
};
