const fs = require("fs");
const path = require("path");
const { Country, State } = require("country-state-city");

function flagFromIso2(iso2) {
  if (!iso2 || iso2.length !== 2) return "";
  return iso2
    .toUpperCase()
    .split("")
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

const countries = Country.getAllCountries()
  .map((c) => ({
    isoCode: c.isoCode,
    name: c.name,
    phoneCode: c.phonecode ? `+${c.phonecode}` : "",
    flag: flagFromIso2(c.isoCode)
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const statesByCountry = {};
for (const country of countries) {
  const states = State.getStatesOfCountry(country.isoCode)
    .map((s) => s.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  statesByCountry[country.isoCode] = states;
}

const output = `window.WorldLocationData = ${JSON.stringify({ countries, statesByCountry })};\n`;
const targetPath = path.join(process.cwd(), "js", "world-location-data.js");
fs.writeFileSync(targetPath, output, "utf8");
console.log(`Generated ${targetPath} with ${countries.length} countries.`);
