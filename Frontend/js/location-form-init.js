(function () {
  function normalizePhoneCode(rawCode) {
    const digitsMatch = String(rawCode || "").match(/\d+/);
    return digitsMatch ? `+${digitsMatch[0]}` : "";
  }

  function makeOption(value, label, selected) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (selected) {
      option.selected = true;
    }
    return option;
  }

  function clearAndAddPlaceholder(selectEl, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    selectEl.appendChild(makeOption("", placeholder, true));
  }

  function populateCountries(countrySelect, countries, preferredCountryName) {
    if (!countrySelect) return;

    clearAndAddPlaceholder(countrySelect, "🌍 Select Country");

    countries.forEach((country) => {
      const label = `${country.flag || ""} ${country.name}`.trim();
      const option = makeOption(country.name, label, country.name === preferredCountryName);
      option.dataset.iso = country.isoCode;
      countrySelect.appendChild(option);
    });

    if (!countrySelect.value && preferredCountryName) {
      countrySelect.value = preferredCountryName;
    }
  }

  function populateStates(stateSelect, states, preferredState) {
    if (!stateSelect) return;

    clearAndAddPlaceholder(stateSelect, "Select State");

    if (!states || !states.length) {
      stateSelect.appendChild(makeOption("N/A", "No states available", false));
      return;
    }

    states.forEach((stateName) => {
      stateSelect.appendChild(makeOption(stateName, stateName, stateName === preferredState));
    });

    if (!stateSelect.value && preferredState) {
      stateSelect.value = preferredState;
    }
  }

  function populateCountryCodes(codeSelect, countries, preferredCode) {
    if (!codeSelect) return;

    clearAndAddPlaceholder(codeSelect, "Select Code");

    countries.forEach((country) => {
      const normalizedCode = normalizePhoneCode(country.phoneCode);
      if (!normalizedCode) return;

      const label = `${country.flag || ""} ${normalizedCode} (${country.name})`.trim();
      const option = makeOption(normalizedCode, label, normalizedCode === preferredCode);
      option.dataset.iso = country.isoCode;
      codeSelect.appendChild(option);
    });

    if (!codeSelect.value && preferredCode) {
      codeSelect.value = preferredCode;
    }
  }

  window.initializeWorldLocationSelectors = function initializeWorldLocationSelectors(config) {
    const data = window.WorldLocationData;
    if (!data || !Array.isArray(data.countries) || !data.statesByCountry) {
      return;
    }

    const countrySelect = document.getElementById(config.countrySelectId);
    const stateSelect = document.getElementById(config.stateSelectId);
    const codeSelect = config.countryCodeSelectId ? document.getElementById(config.countryCodeSelectId) : null;

    if (!countrySelect || !stateSelect) {
      return;
    }

    const countries = data.countries.map((country) => ({
      isoCode: country.isoCode,
      name: country.name,
      phoneCode: normalizePhoneCode(country.phoneCode),
      flag: country.flag || ""
    }));

    const preferredCountry = config.defaultCountry || countrySelect.value || "India";
    const preferredState = stateSelect.value || "";
    const preferredCode = config.defaultCountryCode || (codeSelect ? codeSelect.value : "") || "+91";

    populateCountries(countrySelect, countries, preferredCountry);
    populateCountryCodes(codeSelect, countries, preferredCode);

    function syncStatesToCountry(preferredStateValue) {
      const selectedCountryName = countrySelect.value;
      const selectedCountry = countries.find((country) => country.name === selectedCountryName);
      const states = selectedCountry ? data.statesByCountry[selectedCountry.isoCode] || [] : [];
      populateStates(stateSelect, states, preferredStateValue || "");

      if (codeSelect && selectedCountry && selectedCountry.phoneCode) {
        codeSelect.value = selectedCountry.phoneCode;
      }
    }

    countrySelect.addEventListener("change", function () {
      syncStatesToCountry("");
    });

    syncStatesToCountry(preferredState);
  };
})();
