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
	getProfile,
	nextRenameAt,
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
		nextRenameAt: nextRenameAt(profile.displayNameChangedAt, new Date())?.toISOString() ?? null
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
			// An empty field with an existing name keeps it; a disabled field (cooldown) sends nothing.
			if (displayName.trim() !== '' && displayName !== (actor.displayName ?? '')) {
				await setDisplayName(actor, actor.id, displayName);
			}
			await setMotto(actor, motto);
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
