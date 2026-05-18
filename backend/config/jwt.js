import "dotenv/config";

const fallbackSecret = process.env.NODE_ENV === "production"
  ? null
  : "dev-only-secret-change-this";

export const JWT_SECRET = process.env.JWT_SECRET || fallbackSecret;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production");
}