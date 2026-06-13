import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { verify_liuser, type liuser_payload } from "./auth.js";
import { make_http_error, rethrow_http_error } from "./error.js";
import { Collection, ObjectId } from "mongodb";
import mongo from "../db.js";
import aws from "../services/aws.js";
import { type ss_listing, type ss_listing_photo } from "../models/ss_listing.js";
import template from "../template.js";
import { sanitize_image, verify_buffer_is_image, ext_from_content_type } from "../util.js";
import { randomUUID } from "crypto";
import config from "../config.js";

const GET_DRAFT_SCHEMA = {
    params: {
        type: "object",
        properties: {
            id: { type: "string" },
        },
        required: ["id"],
    },
} as const;

function create_default_listing(liuser_id: string): ss_listing {
    return {
        _id: new ObjectId().toString(),
        seller_id: liuser_id,

        // Yarn details
        title: "",
        description: "",
        price: 0,
        status: "draft",

        brand: "",
        yarn_name: "",
        color: "",
        fiber: "",
        weight: "unknown",
        quantity: 1,
        condition: "unknown",

        photos: [],

        created_at: new Date(),
        updated_at: new Date(),
    };
}

async function insert_listing(draft: ss_listing, listings: Collection<ss_listing>) {
    try {
        const listing = await listings.insertOne(draft);
        if (listing.insertedId != draft._id) {
            throw make_http_error(`Unexpected id ${listing.insertedId} returned (expected ${draft._id})`, 500);
        }
    } catch (err: any) {
        rethrow_http_error(err);
        throw make_http_error("Failed to insert: " + err.msg, 500);
    }
}

async function get_listing(id: string, listings: Collection<ss_listing>): Promise<ss_listing> {
    try {
        const listing = await listings.findOne({ _id: id });
        if (!listing) {
            throw make_http_error(`Could not find listing with id ${id}`, 404);
        }
        return listing;
    } catch (err: any) {
        rethrow_http_error(err);
        throw make_http_error(`Could not find listing with id ${id}`, 404);
    }
}

type route_params = { Params: { id: string } };

async function handle_get_edit_listing_by_id(request: FastifyRequest<route_params>, reply: FastifyReply) {
    const listings = mongo.get_listings();
    const { id } = request.params;
    const listing = await get_listing(id, listings);
    const photo_thumb_section = `<div class="photo-thumb">Photo1</div><div class="photo-thumb">Photo2</div><div class="photo-thumb">Photo3</div>`;
    const html_page = template.render_page_layout("edit-listing", { photo_thumb_section });
    reply.type("text/html").send(html_page);
}

// This will create the listing draft and redirect right away to the edit page for it. This is better than returning a "new listing"
// form because then we can make partial edits in order to auto save stuff
async function handle_post_listing_draft(request: FastifyRequest, reply: FastifyReply) {
    const listings = mongo.get_listings();
    const usr = request.liuser as liuser_payload;
    const draft_listing = create_default_listing(usr.id);
    await insert_listing(draft_listing, listings);
    reply.redirect(`/listings/${draft_listing._id}/edit`);
}

function generate_photo_aws_key(listing_id: string, content_type: string): string {
    return config.aws.s3_listing_pics_pf + "/" + listing_id + "." + ext_from_content_type(content_type);
}

type uploaded_photo_info = {
    tmp_key: string;
    orig_fname: string;
};

type push_listing_body = {
    photos_json: string;
};

function is_uploaded_photo_info(val: unknown): val is uploaded_photo_info {
    return (
        !!val &&
        typeof val === "object" &&
        "tmp_key" in val &&
        typeof val.tmp_key === "string" &&
        "orig_fname" in val &&
        typeof val.orig_fname === "string"
    );
}

async function finalize_photo(
    pinfo: uploaded_photo_info,
    order: number,
    listing_id: string
): Promise<ss_listing_photo> {
    const { file, content_type } = await aws.download_from_s3(pinfo.tmp_key);

    // Remove image from aws - continue even if removal fails
    try {
        await aws.delete_from_s3(pinfo.tmp_key);
    } catch (err: any) {
        const err_msg = err instanceof Error ? ":" + err.message : "";
        elog(`Failed to delete temp upload ${pinfo.tmp_key}${err_msg} - need to fix`);
    }

    if (!verify_buffer_is_image(Buffer.from(file))) {
        // Return some error fragment
    }

    const proms: Promise<Buffer>[] = [];
    const MAIN_PHOTO_IND = 0;
    const CARD_PHOTO_IND = 1;
    const THUMB_PHOTO_IND = 2;

    const main = sanitize_image(file, 1600, 1600, { fit: "inside", withoutEnlargement: true });
    proms[MAIN_PHOTO_IND] = main;

    const card = sanitize_image(file, 400, 400, { fit: "cover", position: "centre", withoutEnlargement: true });
    proms[CARD_PHOTO_IND] = card;

    const thumb = sanitize_image(file, 96, 96, { fit: "cover", position: "centre", withoutEnlargement: true });
    proms[THUMB_PHOTO_IND] = thumb;

    // allSettled only throws for things like syntax errors and such
    const all_results = await Promise.allSettled(proms);

    // Basically filter and map in one call to get our results to a list of only things that succeeded
    const san_results = all_results
        .filter((r) => r.status === "fulfilled")
        .map((r) => ({ data: r.value, key: generate_photo_aws_key(listing_id, content_type), content_type }));

    // If all didn't succeed sanitizing then error
    if (san_results.length !== all_results.length) {
        // Return some error fragment
    }

    // Everything worked - lets do the upload
    const upload_proms = san_results.map(async (r) => {
        await aws.upload_to_s3(r.key, r.data, r.content_type);
        return r.key;
    });

    const all_upload_results = await Promise.allSettled(upload_proms);
    const uploads_succeeded = all_upload_results.filter((r) => r.status === "fulfilled").map((r) => r.value);

    // There's nothing more we can really do here other than log the failure
    const delete_aws_keys = async (keys: string[]) => {
        // Delete the successful uploads and return
        const del_proms = keys.map((r) => aws.delete_from_s3(r));
        const results = await Promise.allSettled(del_proms);
        const failed = results.filter((r) => r.status === "rejected").map((r) => r.reason);
        if (failed.length > 0) elog(`Failed to delete the following photo keys: ${failed.join(", ")}`);
    };

    // If not all uploads succeeded, we need to delete the successful ones
    if (uploads_succeeded.length !== all_upload_results.length) {
        await delete_aws_keys(uploads_succeeded);
        // Return some error fragment
    }

    // Finally, update the listing and save
    return {
        id: randomUUID(),
        aws_keys: {
            main: uploads_succeeded[MAIN_PHOTO_IND]!,
            card: uploads_succeeded[CARD_PHOTO_IND]!,
            thumb: uploads_succeeded[THUMB_PHOTO_IND]!,
        },
        sort_order: order,
    };
}

async function handle_push_listing_photo(request: FastifyRequest<route_params>, reply: FastifyReply) {
    const listings = mongo.get_listings();
    const { id } = request.params;
    const listing = await get_listing(id, listings);
    const parsed: unknown = request.body;
    if (!Array.isArray(parsed) || !parsed.every((val) => is_uploaded_photo_info(val))) {
        // Invalid input format
    }

    const photo_proms = (parsed as uploaded_photo_info[]).map((upload_item, ind) => {
        return finalize_photo(upload_item, listing.photos.length + ind, listing._id);
    });
    const photo_results = await Promise.allSettled(photo_proms);
    const errs = photo_results.filter((r) => r.status === "rejected").map((r) => r.reason);
    const new_photos = photo_results.filter((r) => r.status === "fulfilled").map((r) => r.value);

    if (new_photos.length > 0) {
        // This crazyness basically adds the items to the end of the photos array and sets the
        // sort order based on the index of the item + the base index of the photos array at the time this insert is happening
        const result = await listings.updateOne({ _id: listing }, [
            {
                $set: {
                    photos: {
                        $let: {
                            vars: {
                                existingPhotos: { $ifNull: ["$photos", []] },
                                startIndex: { $size: { $ifNull: ["$photos", []] } },
                            },
                            in: {
                                $concatArrays: [
                                    "$$existingPhotos",
                                    {
                                        $map: {
                                            input: { $range: [0, new_photos.length] },
                                            as: "idx",
                                            in: {
                                                $mergeObjects: [
                                                    { $arrayElemAt: [new_photos, "$$idx"] },
                                                    { sort_order: { $add: ["$$startIndex", "$$idx"] } },
                                                ],
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        ]);

        if (result.matchedCount === 0) {
            // return error fragment and remove uploaded photos
        }
    }
    // return success fragment
}

export function create_listing_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        await fastify.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024 } });
        fastify.post("/listings", { preHandler: verify_liuser }, handle_post_listing_draft);
        fastify.get<route_params>(
            "/listings/:id/edit",
            { preHandler: verify_liuser, schema: GET_DRAFT_SCHEMA },
            handle_get_edit_listing_by_id
        );
    };
}
