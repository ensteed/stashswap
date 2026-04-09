export const config = {
    port: process.env.PORT!,
    app_base_url: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || "3000"}`,
    s3_profile_pics_bucket: process.env.AWS_S3_BUCKET_PROFILE_PICS!,
    s3_region: process.env.AWS_S3_REGION!,
    s3_base_url: `https://${process.env.AWS_S3_BUCKET_PROFILE_PICS!}.s3.${process.env.AWS_S3_REGION!}.amazonaws.com`,
    s3_access_key_id: process.env.AWS_ACCESS_KEY_ID!,
    s3_secret_access_key: process.env.AWS_SECRET_ACCESS_KEY!,
    mongodb_uri: process.env.MONGODB_URI!,
    resend_api_key: process.env.RESEND_API_KEY!,
    stripe_secret_key: process.env.STRIPE_SECRET_KEY!,
    stripe_webhook_secret: process.env.STRIPE_WEBHOOK_SECRET!,
};
