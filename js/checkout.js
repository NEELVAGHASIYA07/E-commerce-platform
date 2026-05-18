import { headers } from "./auth.js";

export async function createCheckoutOrder(orderPayload) {
  const response = await fetch("http://localhost:5000/api/orders", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(orderPayload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Failed to create order");
  }

  return data;
}
