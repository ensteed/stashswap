export type yarn_weight = "lace" | "fingering" | "dk" | "worsted" | "bulky" | "super_bulky" | "unknown";

export type ss_listing_condition = "new_original" | "new_wound" | "partial" | "used" | "unknown";
export type ss_listing_status = "draft" | "active" | "sold" | "archived";

export interface ss_listing_photo {
    id: string;
    aws_keys: {
        main: string;
        card: string;
        thumb: string;
    };
    sort_order: number;
    alt?: string;
}

export interface ss_listing {
    _id: string;
    seller_id: string;

    title: string;
    description: string;
    price: number;
    status: ss_listing_status;

    brand?: string;
    yarn_name?: string;
    color?: string;
    fiber?: string;
    weight?: yarn_weight;
    quantity?: number;
    condition?: ss_listing_condition;

    photos: ss_listing_photo[];

    created_at: Date;
    updated_at: Date;
}
