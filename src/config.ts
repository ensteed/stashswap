export const config = {
    s3_profile_pics_bucket: process.env.AWS_S3_BUCKET_PROFILE_PICS!,
    s3_region: process.env.AWS_S3_REGION!,
    s3_base_url: `https://${process.env.AWS_S3_BUCKET_PROFILE_PICS!}.s3.${process.env.AWS_S3_REGION!}.amazonaws.com`,
    resend_api_key: process.env.RESEND_API_KEY!,
};
