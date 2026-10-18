import pg from "pg";

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getPool(connectionString: string): pg.Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    poolInstance.on("error", (err) => {
      const reason = (err as { code?: string }).code ?? err.name;
      console.error(`Idle database client error (${reason}).`);
    });
  }
  return poolInstance;
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    const current = poolInstance;
    poolInstance = null;
    await current.end();
  }
}
