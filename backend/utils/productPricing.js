const FRONTEND_CATALOG_PRICE = new Map([
  ["waffle maker", 499],
  ["night bulb", 399],
  ["panda bulb", 699],
  ["panda lamp", 699],
  ["headphone", 899],
  ["ear muffs", 399],
  ["galaxy projector", 1299],
  ["aroma diffuser", 999],
  ["nivea body milk", 349],
  ["printed kurta", 999],
  ["earbuds", 1499],
  ["iphone 17 pro max", 164999]
]);

export const normalizeProductKey = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export const buildProductPriceMap = (dbProducts) => {
  const priceMap = new Map();

  for (const product of dbProducts || []) {
    const key = normalizeProductKey(product?.name);
    const price = Number(product?.price);

    if (!key || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    priceMap.set(key, price);
  }

  for (const [key, price] of FRONTEND_CATALOG_PRICE.entries()) {
    if (!priceMap.has(key)) {
      priceMap.set(key, price);
    }
  }

  return priceMap;
};

export const resolveServerPrice = (priceMap, itemName) => {
  const key = normalizeProductKey(itemName);
  if (!key || !priceMap.has(key)) {
    return null;
  }

  return Number(priceMap.get(key));
};
