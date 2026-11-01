import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // max is small: each serverless instance holds its own pool.
  // SSL comes from sslmode in the URL, which the driver parses.
  pool = new pg.Pool({ connectionString, max: 3 });
  // An idle client error would otherwise crash the process.
  pool.on("error", (err) => console.error("pg pool error", err));
  return pool;
}
