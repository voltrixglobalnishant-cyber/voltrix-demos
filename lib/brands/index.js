import { chiaroscuro } from "./chiaroscuro";
import { moxie } from "./moxie";
import { aura } from "./aura";
import { maison } from "./maison";
import { brew } from "./brew";
import { lakemiraya } from "./lakemiraya";

const BRANDS = {
  chiaroscuro,
  moxie,
  aura,
  maison,
  brew,
  lakemiraya,
};

export function getBrand(slug) {
  if (!slug) return null;
  return BRANDS[slug.toLowerCase()] || null;
}

export function listBrands() {
  return Object.keys(BRANDS);
}
