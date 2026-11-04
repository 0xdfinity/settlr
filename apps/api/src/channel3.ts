import type { Config } from "./config.js";
import type { CatalogOffer } from "./ai.js";

type AnyRecord = Record<string, unknown>;

/** Channel3 product search. Returns normalized offers or an empty list; never throws
 *  into the request path when the catalog provider is unavailable. */
export async function searchCatalog(
  config: Config,
  input: { query: string; maxPrice?: number; limit?: number; userId?: string },
): Promise<{ offers: CatalogOffer[]; error?: string }> {
  if (!config.CHANNEL3_API_KEY) return { offers: [], error: "catalog_not_configured" };
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 20);
  const body: AnyRecord = { query: input.query.trim().slice(0, 200), limit };
  if (input.maxPrice && input.maxPrice > 0) body.filters = { price: { max_price: input.maxPrice } };
  try {
    const res = await fetch("https://api.trychannel3.com/v1/search", {
      method: "POST",
      headers: {
        "x-api-key": config.CHANNEL3_API_KEY,
        "Content-Type": "application/json",
        ...(input.userId ? { "x-user-id": input.userId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { offers: [], error: `catalog_${res.status}` };
    const parsed = (await res.json()) as AnyRecord;
    const products = asArray(parsed.products ?? parsed.results ?? parsed.items);
    const offers = products
      .map((p) => bestOffer(p, input.maxPrice))
      .filter((o): o is CatalogOffer => o !== null)
      .sort((a, b) => a.priceUsd - b.priceUsd)
      .slice(0, limit);
    return { offers };
  } catch (err) {
    return { offers: [], error: err instanceof Error ? err.message.slice(0, 120) : "catalog_error" };
  }
}

function asArray(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value as AnyRecord[]).filter((v) => v && typeof v === "object") : [];
}

/** One catalog row per product: the cheapest in-stock offer, with its merchant and buy URL. */
function bestOffer(product: AnyRecord, maxPrice?: number): CatalogOffer | null {
  const title = String(product.title ?? product.name ?? "").slice(0, 200);
  if (!title) return null;

  const offers = asArray(product.offers);
  const priced = offers
    .map((o) => ({ offer: o, price: priceOf(o) }))
    .filter(({ offer, price }) => offer.url && Number.isFinite(price) && price > 0)
    .sort((a, b) => a.price - b.price);

  const chosen = priced.find(({ price }) => !maxPrice || price <= maxPrice) ?? priced[0];
  if (!chosen) return null;

  const brand = asArray(product.brands)[0];
  const merchant =
    String(chosen.offer.domain ?? chosen.offer.merchant ?? brand?.name ?? product.brand ?? "Unknown merchant").slice(0, 200);
  const image = asArray(product.images)[0];

  return {
    title,
    merchant,
    priceUsd: Number(chosen.price.toFixed(2)),
    url: String(chosen.offer.url).slice(0, 2_000),
    imageUrl: (image?.url ?? image?.cleaned_url ?? null) as string | null,
    source: "channel3",
  };
}

function priceOf(offer: AnyRecord): number {
  const price = offer.price;
  if (price && typeof price === "object") {
    const nested = (price as AnyRecord).price;
    const n = Number(nested);
    if (Number.isFinite(n)) return n;
  }
  const flat = Number(offer.price_usd ?? (offer.price_cents ? Number(offer.price_cents) / 100 : NaN));
  return Number.isFinite(flat) ? flat : NaN;
}
