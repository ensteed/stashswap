import { Router, type Request, type Response } from "express";
import { MongoClient, ObjectId, type Collection, type Filter } from "mongodb";
import multer from "multer";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

import { config } from "../config.js";
import { render_fragment } from "../template.js";
import { verify_liuser, type liuser_payload } from "./auth.js";
import type { ss_user } from "./users.js";
import { send_err_resp } from "./error.js";
import { send_email } from "../services/email.js";

const LISTINGS_COLLECTION = "listings";
const LISTING_PAGE_SIZE = 12;
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 6 * 1024 * 1024,
        files: 8,
    },
});
const multer_listing_photos = upload.array("photos", 8);
const s3 = new S3Client({ region: config.s3_region });

const CONDITION_OPTIONS = [
    { value: "new", label: "New" },
    { value: "like_new", label: "Like new" },
    { value: "good", label: "Good" },
    { value: "fair", label: "Fair" },
] as const;

const YARN_WEIGHT_OPTIONS = [
    "",
    "lace",
    "light_fingering",
    "fingering",
    "sport",
    "dk",
    "worsted",
    "aran",
    "bulky",
    "super_bulky",
] as const;

type listing_status = "draft" | "active" | "sold" | "cancelled";
type listing_condition = "new" | "like_new" | "good" | "fair";

interface ss_listing_photo {
    s3_key: string;
    order: number;
}

interface ss_listing_tags {
    fiber_types: string[];
    yarn_weights: string[];
    colors: string[];
}

export interface ss_listing {
    _id: string;
    seller_id: string;
    status: listing_status;
    title: string;
    description: string;
    price: number;
    condition: listing_condition;
    quantity: number;
    quantity_remaining: number;
    photos: ss_listing_photo[];
    tags: ss_listing_tags;
    brand: string;
    weight_grams: number;
    yardage_remaining: number;
    ships_from_zip: string;
    created_at: string;
    updated_at: string;
}

interface listing_form_values {
    title: string;
    description: string;
    price: string;
    condition: string;
    quantity: string;
    brand: string;
    weight_grams: string;
    yardage_remaining: string;
    ships_from_zip: string;
    fiber_types: string;
    yarn_weight: string;
    colors: string;
}

function escape_html(value: string | undefined) {
    return (value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function listing_photo_url(photo: ss_listing_photo | undefined) {
    if (!photo) {
        return "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?auto=format&fit=crop&w=900&q=80";
    }
    return `${config.s3_base_url}/${photo.s3_key}`;
}

function to_money(cents: number) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(cents / 100);
}

function format_weight_label(value: string) {
    return value
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function to_csv(values: string[]) {
    return values.join(", ");
}

function parse_tag_list(value: unknown) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function verify_buffer_is_image(buf: Buffer): boolean {
    const is_jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const is_png = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const is_riff = buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP";
    return is_jpeg || is_png || is_riff;
}

function sanitize_listing_photo(buffer: Buffer) {
    return sharp(buffer)
        .rotate()
        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
}

function default_shipping_zip(user: ss_user) {
    const default_address = (user.addresses || []).find((address) => address.is_default) || user.addresses?.[0];
    return default_address?.zip || "";
}

function make_listing_form_values(listing?: ss_listing, user?: ss_user): listing_form_values {
    return {
        title: listing?.title || "",
        description: listing?.description || "",
        price: listing ? (listing.price / 100).toFixed(2) : "",
        condition: listing?.condition || "good",
        quantity: listing ? String(listing.quantity) : "1",
        brand: listing?.brand || "",
        weight_grams: listing ? String(listing.weight_grams) : "",
        yardage_remaining: listing ? String(listing.yardage_remaining) : "",
        ships_from_zip: listing?.ships_from_zip || (user ? default_shipping_zip(user) : ""),
        fiber_types: listing ? to_csv(listing.tags.fiber_types) : "",
        yarn_weight: listing?.tags.yarn_weights?.[0] || "",
        colors: listing ? to_csv(listing.tags.colors) : "",
    };
}

function normalize_listing_input(input: any, user: ss_user) {
    const values = make_listing_form_values(undefined, user);
    values.title = String(input.title || "").trim();
    values.description = String(input.description || "").trim();
    values.price = String(input.price || "").trim();
    values.condition = String(input.condition || "").trim();
    values.quantity = String(input.quantity || "").trim();
    values.brand = String(input.brand || "").trim();
    values.weight_grams = String(input.weight_grams || "").trim();
    values.yardage_remaining = String(input.yardage_remaining || "").trim();
    values.ships_from_zip = String(input.ships_from_zip || values.ships_from_zip).trim();
    values.fiber_types = String(input.fiber_types || "").trim();
    values.yarn_weight = String(input.yarn_weight || "").trim();
    values.colors = String(input.colors || "").trim();
    return values;
}

function validate_listing_input(values: listing_form_values, has_photos: boolean) {
    const errors: string[] = [];
    const price = Number(values.price);
    const quantity = Number(values.quantity);
    const weight_grams = Number(values.weight_grams);
    const yardage_remaining = Number(values.yardage_remaining);

    if (!values.title) errors.push("Title is required");
    if (!values.description) errors.push("Description is required");
    if (!Number.isFinite(price) || price <= 0) errors.push("Price must be greater than 0");
    if (!CONDITION_OPTIONS.some((option) => option.value === values.condition)) errors.push("Condition is required");
    if (!Number.isInteger(quantity) || quantity < 1) errors.push("Quantity must be a whole number greater than 0");
    if (!values.brand) errors.push("Brand is required");
    if (!Number.isFinite(weight_grams) || weight_grams <= 0) errors.push("Weight in grams must be greater than 0");
    if (!Number.isFinite(yardage_remaining) || yardage_remaining <= 0) errors.push("Yardage must be greater than 0");
    if (!/^\d{5}(-\d{4})?$/.test(values.ships_from_zip)) errors.push("Ships-from ZIP must be a valid US ZIP code");
    if (!has_photos) errors.push("At least one listing photo is required");

    return errors;
}

function build_listing_document(
    listing_id: string,
    seller_id: string,
    values: listing_form_values,
    photos: ss_listing_photo[],
    current_status: listing_status,
    existing_listing?: ss_listing
): ss_listing {
    const now = new Date().toISOString();
    const quantity = Number(values.quantity);

    return {
        _id: listing_id,
        seller_id,
        status: current_status,
        title: values.title,
        description: values.description,
        price: Math.round(Number(values.price) * 100),
        condition: values.condition as listing_condition,
        quantity,
        quantity_remaining: existing_listing ? Math.min(existing_listing.quantity_remaining, quantity) : quantity,
        photos,
        tags: {
            fiber_types: parse_tag_list(values.fiber_types),
            yarn_weights: values.yarn_weight ? [values.yarn_weight] : [],
            colors: parse_tag_list(values.colors),
        },
        brand: values.brand,
        weight_grams: Number(values.weight_grams),
        yardage_remaining: Number(values.yardage_remaining),
        ships_from_zip: values.ships_from_zip,
        created_at: existing_listing?.created_at || now,
        updated_at: now,
    };
}

function selected_attr(current: string, value: string) {
    return current === value ? "selected" : "";
}

function render_condition_options(current: string) {
    return CONDITION_OPTIONS.map(
        (option) => `<option value="${option.value}" ${selected_attr(current, option.value)}>${option.label}</option>`
    ).join("");
}

function render_weight_options(current: string) {
    return YARN_WEIGHT_OPTIONS.map((value) => {
        const label = value ? format_weight_label(value) : "Select yarn weight";
        return `<option value="${value}" ${selected_attr(current, value)}>${label}</option>`;
    }).join("");
}

function render_listing_card(listing: ss_listing, seller_name = "") {
    const primary_photo = listing.photos.sort((a, b) => a.order - b.order)[0];
    const weight = listing.tags.yarn_weights?.[0] ? format_weight_label(listing.tags.yarn_weights[0]) : "Unspecified weight";
    const fiber = listing.tags.fiber_types?.[0] || "mixed fiber";
    const seller_line = seller_name ? `<span>by ${escape_html(seller_name)}</span>` : "";

    return `
        <article class="listing-card">
          <a class="listing-card-link" href="/listings/${listing._id}">
            <div class="listing-card-media">
              <img src="${listing_photo_url(primary_photo)}" alt="${escape_html(listing.title)}">
            </div>
            <div class="listing-card-body">
              <div class="listing-card-topline">
                <span class="listing-chip">${escape_html(weight)}</span>
                <span class="listing-card-price">${to_money(listing.price)}</span>
              </div>
              <h3>${escape_html(listing.title)}</h3>
              <p>${escape_html(listing.brand)} · ${escape_html(fiber)}</p>
              <div class="listing-card-meta">
                <span>${escape_html(CONDITION_OPTIONS.find((item) => item.value === listing.condition)?.label || listing.condition)}</span>
                <span>${listing.weight_grams}g</span>
                <span>${listing.yardage_remaining} yds</span>
                ${seller_line}
              </div>
            </div>
          </a>
        </article>
    `;
}

function render_empty_state(title: string, copy: string, action_html = "") {
    return `
        <section class="market-empty">
          <h3>${escape_html(title)}</h3>
          <p>${escape_html(copy)}</p>
          ${action_html}
        </section>
    `;
}

function render_marketplace_page(content_html: string) {
    return render_fragment("index.html", { main_content_html: content_html });
}

function render_listing_form_page(user: ss_user, options: {
    listing?: ss_listing;
    form_values?: listing_form_values;
    error_html?: string;
    flash_html?: string;
}) {
    const listing = options.listing;
    const values = options.form_values || make_listing_form_values(listing, user);
    const photo_gallery = (listing?.photos || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(
            (photo) => `
                <div class="listing-form-photo">
                  <img src="${listing_photo_url(photo)}" alt="${escape_html(listing?.title || "Listing photo")}">
                </div>
            `
        )
        .join("");

    const html = render_fragment("listing-form.html", {
        page_title: listing ? "Edit listing" : "Create a listing",
        intro_copy: listing
            ? "Update the details shoppers see on your listing page."
            : "Turn spare skeins into a polished listing with photos, yardage, and fiber details.",
        form_action: listing ? `/sell/listings/${listing._id}` : "/sell/listings",
        title: values.title,
        description: values.description,
        price: values.price,
        quantity: values.quantity,
        brand: values.brand,
        weight_grams: values.weight_grams,
        yardage_remaining: values.yardage_remaining,
        ships_from_zip: values.ships_from_zip,
        fiber_types: values.fiber_types,
        colors: values.colors,
        condition_options_html: render_condition_options(values.condition),
        yarn_weight_options_html: render_weight_options(values.yarn_weight),
        error_html: options.error_html || "",
        flash_html: options.flash_html || "",
        existing_photos_html: photo_gallery
            ? `<div class="listing-form-existing-photos">${photo_gallery}</div><p class="field-help">Upload new photos only if you want to replace the current set.</p>`
            : `<p class="field-help">Add up to 8 photos. Images are converted to WebP and resized automatically.</p>`,
        listing_status: listing ? escape_html(listing.status) : "draft",
    });

    return render_marketplace_page(html);
}

function render_dashboard_page(user: ss_user, listings: ss_listing[], flash = "") {
    const grouped = {
        active: listings.filter((listing) => listing.status === "active"),
        draft: listings.filter((listing) => listing.status === "draft"),
        sold: listings.filter((listing) => listing.status === "sold"),
        cancelled: listings.filter((listing) => listing.status === "cancelled"),
    };

    const active_cards = grouped.active.length
        ? grouped.active.map((listing) => render_seller_listing_row(listing)).join("")
        : render_empty_state("No active listings", "Publish a draft to start taking orders.", `<a class="btn-base primary" href="/sell/listings/new">Create listing</a>`);
    const draft_cards = grouped.draft.length
        ? grouped.draft.map((listing) => render_seller_listing_row(listing)).join("")
        : render_empty_state("No drafts", "Start a draft when you want to prepare photos and details before publishing.");
    const sold_cards = grouped.sold.length
        ? grouped.sold.map((listing) => render_seller_listing_row(listing)).join("")
        : render_empty_state("No sold listings yet", "Your sold inventory will show up here once checkout is added.");

    const html = render_fragment("seller-dashboard.html", {
        seller_name: escape_html(user.profile?.public_name || user.first_name || user.username),
        flash_html: flash ? `<div class="save-success-ind">${escape_html(flash)}</div>` : "",
        email_status_badge: user.email_verified
            ? `<span class="status-pill ok">Email verified</span>`
            : `<span class="status-pill warn">Email verification required before publishing</span>`,
        active_listings_html: active_cards,
        draft_listings_html: draft_cards,
        sold_listings_html: sold_cards,
        payout_status: user.seller?.stripe_account_id
            ? escape_html(user.seller.stripe_onboarding_complete ? "Stripe onboarding linked" : "Stripe account started")
            : "No Stripe account linked yet",
    });

    return render_marketplace_page(html);
}

function render_seller_listing_row(listing: ss_listing) {
    const can_publish = listing.status === "draft";
    const can_cancel = listing.status === "draft" || listing.status === "active";
    const primary_photo = listing.photos.sort((a, b) => a.order - b.order)[0];
    const view_href = listing.status === "active" ? `/listings/${listing._id}` : `/sell/listings/${listing._id}/edit`;

    return `
        <article class="seller-listing-row">
          <div class="seller-listing-row-media">
            <img src="${listing_photo_url(primary_photo)}" alt="${escape_html(listing.title)}">
          </div>
          <div class="seller-listing-row-copy">
            <div class="seller-listing-row-top">
              <h3>${escape_html(listing.title)}</h3>
              <span class="status-pill">${escape_html(listing.status)}</span>
            </div>
            <p>${escape_html(listing.brand)} · ${to_money(listing.price)} · ${listing.quantity_remaining}/${listing.quantity} remaining</p>
            <div class="seller-listing-row-actions">
              <a class="btn-base" href="${view_href}">View</a>
              <a class="btn-base" href="/sell/listings/${listing._id}/edit">Edit</a>
              ${can_publish ? `<form method="post" action="/sell/listings/${listing._id}/publish"><button class="base primary" type="submit">Publish</button></form>` : ""}
              ${can_cancel ? `<form method="post" action="/sell/listings/${listing._id}/cancel"><button class="base" type="submit">Cancel</button></form>` : ""}
            </div>
          </div>
        </article>
    `;
}

function render_home_page(listings: ss_listing[]) {
    const cards_html = listings.length
        ? listings.map((listing) => render_listing_card(listing)).join("")
        : render_empty_state("No listings yet", "The marketplace is empty right now. Be the first seller to post a skein.", `<a class="btn-base primary" href="/sell/listings/new">Create the first listing</a>`);

    const html = render_fragment("storefront-home.html", {
        featured_listings_html: cards_html,
    });
    return render_marketplace_page(html);
}

function render_browse_page(args: {
    listings: ss_listing[];
    current_query: Record<string, string>;
    page: number;
    total_pages: number;
}) {
    const cards_html = args.listings.length
        ? args.listings.map((listing) => render_listing_card(listing)).join("")
        : render_empty_state("No matches", "Try widening your filters or clearing the search to see more yarn.");
    const page_links = Array.from({ length: args.total_pages }, (_, index) => {
        const page = index + 1;
        const params = new URLSearchParams({ ...args.current_query, page: String(page) });
        return `<a class="pagination-link ${page === args.page ? "active" : ""}" href="/browse?${params.toString()}">${page}</a>`;
    }).join("");

    const html = render_fragment("browse.html", {
        q: args.current_query.q || "",
        min_price: args.current_query.min_price || "",
        max_price: args.current_query.max_price || "",
        fiber_type: args.current_query.fiber_type || "",
        condition_options_html: render_condition_options(args.current_query.condition || ""),
        yarn_weight_options_html: render_weight_options(args.current_query.yarn_weight || ""),
        listing_cards_html: cards_html,
        pagination_html: page_links,
    });
    return render_marketplace_page(html);
}

function render_listing_detail_page(listing: ss_listing, seller: ss_user, flash = "") {
    const gallery = listing.photos
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(
            (photo) => `
                <div class="listing-gallery-item">
                  <img src="${listing_photo_url(photo)}" alt="${escape_html(listing.title)}">
                </div>
            `
        )
        .join("");

    const tags = [...listing.tags.yarn_weights, ...listing.tags.fiber_types, ...listing.tags.colors]
        .filter(Boolean)
        .map((tag) => `<span class="listing-chip">${escape_html(format_weight_label(tag))}</span>`)
        .join("");

    const html = render_fragment("listing-detail.html", {
        listing_title: escape_html(listing.title),
        listing_price: to_money(listing.price),
        listing_description: escape_html(listing.description),
        listing_brand: escape_html(listing.brand),
        listing_condition: escape_html(CONDITION_OPTIONS.find((item) => item.value === listing.condition)?.label || listing.condition),
        listing_weight_grams: String(listing.weight_grams),
        listing_yardage_remaining: String(listing.yardage_remaining),
        listing_quantity_remaining: String(listing.quantity_remaining),
        seller_name: escape_html(seller.profile?.public_name || seller.first_name || seller.username),
        seller_about: escape_html(seller.profile?.about || "Seller profile details will expand here as the marketplace grows."),
        gallery_html: gallery,
        tags_html: tags,
        flash_html: flash ? `<div class="save-success-ind">${escape_html(flash)}</div>` : "",
        listing_id: listing._id,
    });

    return render_marketplace_page(html);
}

async function load_user(users: Collection<ss_user>, req: Request, res: Response) {
    const liuser = req.liuser as liuser_payload;
    const user = await users.findOne({ _id: liuser.id });
    if (!user) {
        send_err_resp(404, "User not found", res);
        return null;
    }
    return user as ss_user;
}

async function load_owned_listing(listings: Collection<ss_listing>, seller_id: string, listing_id: string) {
    return listings.findOne({ _id: listing_id, seller_id });
}

async function upload_listing_photos(listing_id: string, files: Express.Multer.File[]) {
    const photos: ss_listing_photo[] = [];

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!file) {
            throw new Error(`Photo ${index + 1} is missing`);
        }
        if (!verify_buffer_is_image(file.buffer)) {
            throw new Error(`Photo ${index + 1} is not a valid image`);
        }

        const sanitized = await sanitize_listing_photo(file.buffer);
        const key = `listings/${listing_id}/${index + 1}.webp`;
        await s3.send(
            new PutObjectCommand({
                Bucket: config.s3_profile_pics_bucket,
                Key: key,
                Body: sanitized,
                ContentType: "image/webp",
            })
        );
        photos.push({ s3_key: key, order: index });
    }

    return photos;
}

function verification_link(token: string) {
    return `${config.app_base_url}/sell/verify-email?token=${encodeURIComponent(token)}`;
}

async function send_seller_verification_email(users: Collection<ss_user>, user: ss_user) {
    const token = crypto.randomBytes(24).toString("hex");
    await users.updateOne(
        { _id: user._id },
        {
            $set: {
                email_verify_token: token,
            },
        }
    );

    return await new Promise<string>((resolve, reject) => {
        send_email(
            {
                to: user.email,
                from: "onboarding@noblesteed.dev",
                subject: "Verify your StashSwap seller email",
                html: `
                    <p>Verify your email to publish listings on StashSwap.</p>
                    <p><a href="${verification_link(token)}">Verify seller email</a></p>
                `,
            },
            (response) => {
                if (response.error) {
                    reject(new Error(response.error));
                    return;
                }
                resolve(token);
            }
        );
    });
}

function parse_browse_query(req: Request) {
    return {
        q: String(req.query.q || "").trim(),
        yarn_weight: String(req.query.yarn_weight || "").trim(),
        fiber_type: String(req.query.fiber_type || "").trim().toLowerCase(),
        condition: String(req.query.condition || "").trim(),
        min_price: String(req.query.min_price || "").trim(),
        max_price: String(req.query.max_price || "").trim(),
        page: Math.max(1, Number(req.query.page || "1") || 1),
    };
}

function build_browse_filter(query: ReturnType<typeof parse_browse_query>) {
    const filter: Filter<ss_listing> = { status: "active" };
    const and_filters: Filter<ss_listing>[] = [];

    if (query.q) {
        const regex = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        and_filters.push({
            $or: [{ title: regex }, { description: regex }, { brand: regex }],
        } as Filter<ss_listing>);
    }
    if (query.yarn_weight) {
        and_filters.push({ "tags.yarn_weights": query.yarn_weight } as Filter<ss_listing>);
    }
    if (query.fiber_type) {
        and_filters.push({ "tags.fiber_types": query.fiber_type } as Filter<ss_listing>);
    }
    if (query.condition) {
        and_filters.push({ condition: query.condition as listing_condition } as Filter<ss_listing>);
    }

    const price_filter: Record<string, number> = {};
    if (query.min_price && Number.isFinite(Number(query.min_price))) {
        price_filter.$gte = Math.round(Number(query.min_price) * 100);
    }
    if (query.max_price && Number.isFinite(Number(query.max_price))) {
        price_filter.$lte = Math.round(Number(query.max_price) * 100);
    }
    if (Object.keys(price_filter).length) {
        and_filters.push({ price: price_filter } as Filter<ss_listing>);
    }

    if (and_filters.length) {
        filter.$and = and_filters;
    }

    return filter;
}

async function ensure_listing_indexes(listings: Collection<ss_listing>) {
    await Promise.all([
        listings.createIndex({ seller_id: 1 }),
        listings.createIndex({ status: 1 }),
        listings.createIndex({ "tags.yarn_weights": 1 }),
        listings.createIndex({ "tags.fiber_types": 1 }),
        listings.createIndex({ price: 1 }),
        listings.createIndex({ created_at: -1 }),
    ]);
}

function redirect_or_send(res: Response, location: string) {
    res.redirect(location);
}

function listing_form_error_html(errors: string[]) {
    return `<div class="errors">${errors.map((error) => `<p>${escape_html(error)}</p>`).join("")}</div>`;
}

export function create_listing_routes(mongo_client: MongoClient): Router {
    const db = mongo_client.db(process.env.DB_NAME);
    const users = db.collection<ss_user>(process.env.USER_COLLECTION_NAME!);
    const listings = db.collection<ss_listing>(LISTINGS_COLLECTION);
    void ensure_listing_indexes(listings).catch((err) => {
        elog("Failed to create listing indexes", err);
    });

    const router = Router();

    router.get("/", async (_req: Request, res: Response) => {
        try {
            const featured = await listings.find({ status: "active" }).sort({ created_at: -1 }).limit(8).toArray();
            res.type("html").send(render_home_page(featured));
        } catch (err: any) {
            send_err_resp(500, `Could not load storefront: ${err.message}`, res);
        }
    });

    router.get("/browse", async (req: Request, res: Response) => {
        try {
            const query = parse_browse_query(req);
            const filter = build_browse_filter(query);
            const total_count = await listings.countDocuments(filter);
            const total_pages = Math.max(1, Math.ceil(total_count / LISTING_PAGE_SIZE));
            const page = Math.min(query.page, total_pages);
            const docs = await listings
                .find(filter)
                .sort({ created_at: -1 })
                .skip((page - 1) * LISTING_PAGE_SIZE)
                .limit(LISTING_PAGE_SIZE)
                .toArray();

            res.type("html").send(
                render_browse_page({
                    listings: docs,
                    current_query: {
                        q: query.q,
                        yarn_weight: query.yarn_weight,
                        fiber_type: query.fiber_type,
                        condition: query.condition,
                        min_price: query.min_price,
                        max_price: query.max_price,
                    },
                    page,
                    total_pages,
                })
            );
        } catch (err: any) {
            send_err_resp(500, `Could not load listings: ${err.message}`, res);
        }
    });

    router.get("/listings/:listing_id", async (req: Request, res: Response) => {
        try {
            const listing_id = req.params.listing_id || "";
            const listing = await listings.findOne({ _id: listing_id, status: "active" });
            if (!listing) {
                send_err_resp(404, "Listing not found", res);
                return;
            }

            const seller = await users.findOne({ _id: listing.seller_id });
            if (!seller) {
                send_err_resp(404, "Seller not found", res);
                return;
            }
            res.type("html").send(render_listing_detail_page(listing, seller));
        } catch (err: any) {
            send_err_resp(500, `Could not load listing: ${err.message}`, res);
        }
    });

    router.get("/sell", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            const seller_listings = await listings.find({ seller_id: user._id }).sort({ created_at: -1 }).toArray();
            res.type("html").send(render_dashboard_page(user, seller_listings, String(req.query.flash || "")));
        } catch (err: any) {
            send_err_resp(500, `Could not load seller dashboard: ${err.message}`, res);
        }
    });

    router.get("/sell/listings/new", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            res.type("html").send(render_listing_form_page(user, {}));
        } catch (err: any) {
            send_err_resp(500, `Could not load listing form: ${err.message}`, res);
        }
    });

    router.get("/sell/listings/:listing_id/edit", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            const listing_id = req.params.listing_id || "";
            const listing = await load_owned_listing(listings, user._id, listing_id);
            if (!listing) {
                send_err_resp(404, "Listing not found", res);
                return;
            }
            res.type("html").send(render_listing_form_page(user, { listing }));
        } catch (err: any) {
            send_err_resp(500, `Could not load listing editor: ${err.message}`, res);
        }
    });

    router.post("/sell/listings", verify_liuser, multer_listing_photos, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            const files = (req.files as Express.Multer.File[]) || [];
            const values = normalize_listing_input(req.body, user);
            const errors = validate_listing_input(values, files.length > 0);
            if (errors.length) {
                res.type("html").send(render_listing_form_page(user, { form_values: values, error_html: listing_form_error_html(errors) }));
                return;
            }

            const listing_id = new ObjectId().toString();
            const photos = await upload_listing_photos(listing_id, files);
            const next_status = req.body.submit_action === "publish" && user.email_verified ? "active" : "draft";
            const listing = build_listing_document(listing_id, user._id, values, photos, next_status);
            await listings.insertOne(listing);

            if (req.body.submit_action === "publish" && !user.email_verified) {
                await send_seller_verification_email(users, user);
                redirect_or_send(res, "/sell?flash=Verify%20your%20email%20before%20publishing.%20We%20sent%20a%20verification%20link.");
                return;
            }

            redirect_or_send(res, "/sell?flash=Listing%20saved");
        } catch (err: any) {
            send_err_resp(500, `Could not save listing: ${err.message}`, res);
        }
    });

    router.post("/sell/listings/:listing_id", verify_liuser, multer_listing_photos, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            const listing_id = req.params.listing_id || "";
            const listing = await load_owned_listing(listings, user._id, listing_id);
            if (!listing) {
                send_err_resp(404, "Listing not found", res);
                return;
            }

            const files = (req.files as Express.Multer.File[]) || [];
            const values = normalize_listing_input(req.body, user);
            const next_photos = files.length ? await upload_listing_photos(listing._id, files) : listing.photos;
            const errors = validate_listing_input(values, next_photos.length > 0);
            if (errors.length) {
                res.type("html").send(
                    render_listing_form_page(user, {
                        listing,
                        form_values: values,
                        error_html: listing_form_error_html(errors),
                    })
                );
                return;
            }

            const next_status =
                req.body.submit_action === "publish"
                    ? user.email_verified
                        ? "active"
                        : "draft"
                    : listing.status === "sold" || listing.status === "cancelled"
                      ? listing.status
                      : "draft";
            const next_listing = build_listing_document(listing._id, user._id, values, next_photos, next_status, listing);
            await listings.updateOne({ _id: listing._id }, { $set: next_listing });

            if (req.body.submit_action === "publish" && !user.email_verified) {
                await send_seller_verification_email(users, user);
                redirect_or_send(res, "/sell?flash=Verify%20your%20email%20before%20publishing.%20We%20sent%20a%20verification%20link.");
                return;
            }

            redirect_or_send(res, "/sell?flash=Listing%20updated");
        } catch (err: any) {
            send_err_resp(500, `Could not update listing: ${err.message}`, res);
        }
    });

    router.post("/sell/listings/:listing_id/publish", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            const listing_id = req.params.listing_id || "";
            const listing = await load_owned_listing(listings, user._id, listing_id);
            if (!listing) {
                send_err_resp(404, "Listing not found", res);
                return;
            }
            if (!user.email_verified) {
                await send_seller_verification_email(users, user);
                redirect_or_send(res, "/sell?flash=Verify%20your%20email%20before%20publishing.%20We%20sent%20a%20verification%20link.");
                return;
            }

            await listings.updateOne(
                { _id: listing._id },
                {
                    $set: {
                        status: "active",
                        updated_at: new Date().toISOString(),
                    },
                }
            );
            redirect_or_send(res, "/sell?flash=Listing%20published");
        } catch (err: any) {
            send_err_resp(500, `Could not publish listing: ${err.message}`, res);
        }
    });

    router.post("/sell/listings/:listing_id/cancel", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            const listing_id = req.params.listing_id || "";
            const listing = await load_owned_listing(listings, user._id, listing_id);
            if (!listing) {
                send_err_resp(404, "Listing not found", res);
                return;
            }
            if (listing.status === "sold") {
                send_err_resp(400, "Sold listings cannot be cancelled", res);
                return;
            }

            await listings.updateOne(
                { _id: listing._id },
                {
                    $set: {
                        status: "cancelled",
                        updated_at: new Date().toISOString(),
                    },
                }
            );
            redirect_or_send(res, "/sell?flash=Listing%20cancelled");
        } catch (err: any) {
            send_err_resp(500, `Could not cancel listing: ${err.message}`, res);
        }
    });

    router.get("/sell/verify-email", async (req: Request, res: Response) => {
        try {
            const token = String(req.query.token || "");
            if (!token) {
                send_err_resp(400, "Verification token is required", res);
                return;
            }

            const user = await users.findOne({ email_verify_token: token });
            if (!user) {
                send_err_resp(404, "Verification token not found", res);
                return;
            }

            await users.updateOne(
                { _id: user._id },
                {
                    $set: {
                        email_verified: true,
                        email_verify_token: "",
                    },
                }
            );

            redirect_or_send(res, "/sell?flash=Seller%20email%20verified.%20You%20can%20now%20publish%20listings.");
        } catch (err: any) {
            send_err_resp(500, `Could not verify email: ${err.message}`, res);
        }
    });

    router.post("/api/listings/:listing_id/cart-placeholder", async (req: Request, res: Response) => {
        try {
            const listing_id = req.params.listing_id || "";
            const listing = await listings.findOne({ _id: listing_id, status: "active" });
            if (!listing) {
                send_err_resp(404, "Listing not found", res);
                return;
            }

            res.type("html").send(
                `<div id="listing-detail-flash" class="save-success-ind">Cart and checkout are next. This listing is ready for buyer flow wiring.</div>`
            );
        } catch (err: any) {
            send_err_resp(500, `Could not queue listing: ${err.message}`, res);
        }
    });

    return router;
}
