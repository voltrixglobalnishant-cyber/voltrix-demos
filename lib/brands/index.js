// lib/brands/index.js
// Central registry. To add a new client, create a file like chiaroscuro.js
// and register it here. The [brand] URL param maps to these keys.

import { chiaroscuro } from "./chiaroscuro";
import { moxie } from "./moxie";
import { aura } from "./aura";
import { maison } from "./maison";
import { brew } from "./brew";

const BRANDS = {
  // Custom client demos
  chiaroscuro,
  moxie,
  // Generic category demos (for cold outreach)
  aura,      // beauty / skincare / haircare
  maison,    // fashion / accessories / bags
  brew,      // cafe / F&B / hospitality
};

export function getBrand(slug) {
  if (!slug) return null;
  return BRANDS[slug.toLowerCase()] || null;
}

export function listBrands() {
  return Object.keys(BRANDS);
}
