export interface ss_user_profile {
    pfp_s3_key: string;
    about: string;
    public_name: string;
}

export interface ss_user_address {
    id: string;
    street: string;
    street2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    is_default: boolean;
}

export interface ss_user_seller {
    stripe_account_id: string;
    stripe_onboarding_complete: boolean;
    stripe_charges_enabled: boolean;
    stripe_payouts_enabled: boolean;
}

export interface ss_user {
    _id: string;
    created_at: Date;
    updated_at: Date;
    username: string;
    first_name: string;
    last_name: string;
    email: string;
    pwd: string;
    profile: ss_user_profile;
    addresses: ss_user_address[];
    seller: ss_user_seller;
}
