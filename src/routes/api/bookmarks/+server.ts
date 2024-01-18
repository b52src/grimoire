import { authenticateUserApiRequest } from '$lib/pb';
import { getFileUrl, prepareTags } from '$lib/utils';
import joi from 'joi';

import { json } from '@sveltejs/kit';

import type { Bookmark } from '$lib/types/Bookmark.type.js';

type AddBookmarkRequestBody = {
	url: string;
	title: string;
	description?: string;
	author?: string;
	content_text?: string;
	content_html?: string;
	content_type?: string;
	content_published_date?: Date | null;
	note?: string;
	main_image_url?: string;
	icon_url?: string;
	importance?: number;
	flagged?: boolean;
	category: string;
	tags?: {
		label: string;
		value: string;
	}[];
};

type UpdateBookmarkRequestBody = AddBookmarkRequestBody & {
	id: string;
};

export async function GET({ locals, url, request }) {
	const { owner, error } = await authenticateUserApiRequest(locals.pb, request);

	if (error) {
		return error;
	}

	const { searchParams } = url;
	const ids = (searchParams.get('ids') || '').split(',') as string[];

	const filterExpression = ids[0]
		? `(${ids.map((id) => `id="${id}"`).join('||')} && owner="${owner}")`
		: `owner="${owner}"`;

	try {
		const bookmarks = await locals.pb
			.collection('bookmarks')
			.getFullList({
				filter: filterExpression,
				expand: 'category,tags'
			})
			.then((res) => {
				return res.map(({ expand, ...bookmark }) => ({
					...bookmark,
					icon: getFileUrl('bookmarks', bookmark.id, bookmark.icon),
					main_image: getFileUrl('bookmarks', bookmark.id, bookmark.main_image),
					...(expand || {})
				}));
			});

		return json(
			{ bookmarks },
			{
				status: 200
			}
		);
	} catch (error: any) {
		return json(
			{
				success: false,
				error: error?.message
			},
			{
				status: 500
			}
		);
	}
}

export async function POST({ locals, request }) {
	const { owner, error: authError } = await authenticateUserApiRequest(locals.pb, request);

	if (authError) {
		return authError;
	}

	const requestBody: AddBookmarkRequestBody = await request.json();

	const validationSchema = joi.object<AddBookmarkRequestBody>({
		url: joi.string().uri().required(),
		title: joi.string().required(),
		description: joi.string().allow('').optional(),
		author: joi.string().allow('').optional(),
		content_text: joi.string().allow('').optional(),
		content_html: joi.string().allow('').optional(),
		content_type: joi.string().allow('').optional(),
		content_published_date: joi.date().allow(null).optional(),
		note: joi.string().allow('').optional(),
		main_image_url: joi.string().allow('').optional(),
		icon_url: joi.string().allow('').optional(),
		importance: joi.number().min(0).max(3).optional(),
		flagged: joi.boolean().optional(),
		category: joi.string().required(),
		tags: joi
			.array()
			.items(
				joi.object({
					label: joi.string().required(),
					value: joi.string().required()
				})
			)
			.optional()
	});

	const { error } = validationSchema.validate(requestBody);

	if (error) {
		return json(
			{
				success: false,
				error: error.message
			},
			{
				status: 400
			}
		);
	}

	try {
		const tags = requestBody.tags || [];
		const tagIds = await prepareTags(locals.pb, tags, owner);

		const bookmark = (await locals.pb.collection('bookmarks').create({
			owner,
			content_html: requestBody.content_html,
			content_published_date: requestBody.content_published_date,
			content_text: requestBody.content_text,
			content_type: requestBody.content_type,
			description: requestBody.description,
			domain: new URL(requestBody.url).hostname,
			icon_url: requestBody.icon_url,
			importance: requestBody.importance,
			main_image_url: requestBody.main_image_url,
			note: requestBody.note,
			title: requestBody.title,
			url: requestBody.url,
			author: requestBody.author,
			tags: tagIds,
			flagged: requestBody.flagged ? new Date().toISOString() : null
		})) as Bookmark;

		if (!bookmark.id) {
			return json(
				{
					success: false,
					error: 'Bookmark creation failed'
				},
				{
					status: 400
				}
			);
		}

		if (requestBody.main_image_url || requestBody.icon_url) {
			const attachments = new FormData();

			if (requestBody.main_image_url) {
				const main_image = await fetch(requestBody.main_image_url as string).then((r) => r.blob());
				attachments.append('main_image', main_image);
			}

			if (requestBody.icon_url) {
				const icon = await fetch(requestBody.icon_url as string).then((r) => r.blob());
				attachments.append('icon', icon);
			}

			await locals.pb.collection('bookmarks').update(bookmark.id, attachments);
		}

		return json(
			{ bookmark },
			{
				status: 201
			}
		);
	} catch (error: any) {
		return json(
			{
				success: false,
				error: error?.message
			},
			{
				status: 500
			}
		);
	}
}

export async function PATCH({ locals, request }) {
	const { owner, error: authError } = await authenticateUserApiRequest(locals.pb, request);

	if (authError) {
		return authError;
	}

	const requestBody: UpdateBookmarkRequestBody = await request.json();

	const validationSchema = joi.object<UpdateBookmarkRequestBody>({
		id: joi.string().required(),
		url: joi.string().uri().optional(),
		title: joi.string().optional(),
		description: joi.string().allow('').optional(),
		author: joi.string().allow('').optional(),
		content_text: joi.string().allow('').optional(),
		content_html: joi.string().allow('').optional(),
		content_type: joi.string().allow('').optional(),
		content_published_date: joi.date().optional(),
		note: joi.string().allow('').optional(),
		main_image_url: joi.string().allow('').optional(),
		icon_url: joi.string().allow('').optional(),
		importance: joi.number().min(0).max(3).optional(),
		flagged: joi.boolean().optional(),
		category: joi.string().optional(),
		tags: joi
			.array()
			.items(
				joi.object({
					label: joi.string().required(),
					value: joi.string().required()
				})
			)
			.optional()
	});

	const { error } = validationSchema.validate(requestBody);

	if (error) {
		return json(
			{
				success: false,
				error: error.message
			},
			{
				status: 400
			}
		);
	}

	const { id, ...updatedFields } = requestBody;

	try {
		const currentBookmark = await locals.pb.collection('bookmarks').getOne(id);

		if (!currentBookmark || currentBookmark.owner !== owner) {
			return json(
				{
					success: false,
					error: 'Bookmark not found'
				},
				{
					status: 404
				}
			);
		}

		const tags = requestBody.tags || [];
		const tagIds = await prepareTags(locals.pb, tags, owner);

		const bookmark = (await locals.pb.collection('bookmarks').update(
			id,
			{
				...updatedFields,
				tags: tagIds,
				flagged: requestBody.flagged ? new Date().toISOString() : null
			},
			{
				filter: `owner="${owner}"`
			}
		)) as Bookmark;

		if (!bookmark.id) {
			return json(
				{
					success: false,
					error: 'Bookmark update failed'
				},
				{
					status: 400
				}
			);
		}

		if (requestBody.main_image_url || requestBody.icon_url) {
			const attachments = new FormData();

			if (requestBody.main_image_url) {
				const main_image = await fetch(requestBody.main_image_url as string).then((r) => r.blob());
				attachments.append('main_image', main_image);
			}

			if (requestBody.icon_url) {
				const icon = await fetch(requestBody.icon_url as string).then((r) => r.blob());
				attachments.append('icon', icon);
			}

			await locals.pb.collection('bookmarks').update(bookmark.id, attachments);
		}

		return json(
			{ bookmark },
			{
				status: 200
			}
		);
	} catch (error: any) {
		return json(
			{
				success: false,
				error: error?.message
			},
			{
				status: 500
			}
		);
	}
}

export async function DELETE({ locals, request, url }) {
	const { owner, error: authError } = await authenticateUserApiRequest(locals.pb, request);

	if (authError) {
		return authError;
	}

	try {
		const id = url.searchParams.get('id') || '';

		if (!id) {
			return json(
				{
					success: false,
					error: 'Bookmark ID is required'
				},
				{
					status: 400
				}
			);
		}

		const currentBookmark = await locals.pb.collection('bookmarks').getOne(id);

		if (!currentBookmark || currentBookmark.owner !== owner) {
			return json(
				{
					success: false,
					error: 'Bookmark not found'
				},
				{
					status: 404
				}
			);
		}

		const success = await locals.pb.collection('bookmarks').delete(id, {
			query: {
				owner
			}
		});

		return json(
			{ success },
			{
				status: 200
			}
		);
	} catch (error: any) {
		return json(
			{
				success: false,
				error: error?.message
			},
			{
				status: 500
			}
		);
	}
}