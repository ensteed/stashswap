function require_env_string(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} (string) is required but not set.`);
    return value;
}

function require_env_int(name: string): number {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} (int) is required but not set.`);
    return parseInt(value);
}

function require_env_float(name: string): number {
    const value = process.env[name];
    if (!value) throw new Error(`Environment variable ${name} (float) is required but not set.`);
    return parseFloat(value);
}

export const config = {
    port: require_env_int("PORT"),
    stripe: {
        app_base_url: require_env_string("STRIPE_APP_BASE_URL"),
        secret_key: require_env_string("STRIPE_SECRET_KEY"),
        webhook_secret: require_env_string("STRIPE_WEBHOOK_SECRET"),
    },
    aws: {
        s3_profile_pics_bucket: require_env_string("AWS_S3_BUCKET_PROFILE_PICS"),
        s3_region: require_env_string("AWS_S3_REGION"),
        s3_base_url: `https://${require_env_string("AWS_S3_BUCKET_PROFILE_PICS")}.s3.${require_env_string("AWS_S3_REGION")}.amazonaws.com`,
        s3_access_key_id: require_env_string("AWS_ACCESS_KEY_ID"),
        s3_secret_access_key: require_env_string("AWS_SECRET_ACCESS_KEY"),
    },
    auth: {
        secret_jwt_key: require_env_string("SECRET_JWT_KEY"),
    },
    mongo: {
        uri: require_env_string("MONGODB_URI"),
        db: require_env_string("MONGODB_DBNAME"),
        users: require_env_string("MONGODB_USERS"),
        listings: require_env_string("MONGODB_LISTINGS"),
    },
    resend: {
        api_key: require_env_string("RESEND_API_KEY"),
    },
};
