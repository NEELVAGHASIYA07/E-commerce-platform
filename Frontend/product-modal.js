let _lastFocusedBeforeModal = null;

function openModal(name, price, desc, platforms, image, category) {
  const modalEl = document.getElementById("modal");
  if (!modalEl) return;

  _lastFocusedBeforeModal = document.activeElement;
  document.getElementById("modalTitle").innerText = name;
  document.getElementById("modalPrice").innerText = price;
  document.getElementById("modalDesc").innerText = desc;
  const modalImgEl = document.getElementById("modalImg");
  modalImgEl.src = "imgs/" + image;
  modalImgEl.alt = name;
  modalImgEl.loading = "eager";
  modalImgEl.decoding = "async";
  const modalRatingEl = document.getElementById("modalRating");
  const latestReviewsEl = document.getElementById("modalLatestReviews");
  if (modalRatingEl) {
    modalRatingEl.innerText = "Loading rating...";
  }
  if (latestReviewsEl) {
    latestReviewsEl.innerHTML = "";
  }

  // Render action buttons
  const actionsDiv = document.getElementById("modalActions");
  if (actionsDiv) {
    const eName = name.replace(/'/g, "\\'");
    actionsDiv.innerHTML = `
      <button class="modal-btn modal-btn-cart" onclick="event.stopPropagation(); addToCart('${eName}', ${parseFloat(String(price).replace(/[^\d.]/g, '')) || 0}, '${image}'); showToast('${eName} added to cart!');">
        <i class="fa-solid fa-cart-plus"></i> Add to Cart
      </button>
      <a href="4.shop.html" class="modal-btn modal-btn-shop">
        <i class="fa-solid fa-arrow-left"></i> Back to Shop
      </a>
    `;
  }

  // Track product view in recommendation engine
  if (typeof RecommendationEngine !== 'undefined') {
    const numPrice = parseFloat(String(price).replace(/[^\d.]/g, '')) || 0;
    RecommendationEngine.trackView(name, numPrice, image, category || '');
    RecommendationEngine.loadProductRecommendations(name, desc, category || '');
  }

  loadModalRating(name);

  modalEl.style.display = "flex";
  modalEl.setAttribute("aria-hidden", "false");

  const closeBtn = modalEl.querySelector(".close");
  if (closeBtn) {
    closeBtn.setAttribute("role", "button");
    closeBtn.setAttribute("tabindex", "0");
    closeBtn.setAttribute("aria-label", "Close product details");
    closeBtn.focus();
  }
}

function renderStars(average) {
  const safeAverage = Number(average || 0);
  const rounded = Math.round(safeAverage);
  let stars = "";
  for (let i = 1; i <= 5; i += 1) {
    stars += i <= rounded ? "★" : "☆";
  }
  return stars;
}

async function loadModalRating(productName) {
  const modalRatingEl = document.getElementById("modalRating");
  const latestReviewsEl = document.getElementById("modalLatestReviews");
  if (!modalRatingEl) return;

  try {
    const response = await fetch(`http://localhost:5000/api/products/reviews/${encodeURIComponent(productName)}`);
    const data = await response.json();
    if (!response.ok) {
      modalRatingEl.innerText = "No ratings yet";
      if (latestReviewsEl) {
        latestReviewsEl.innerHTML = "";
      }
      return;
    }

    const averageRating = Number(data?.averageRating || 0);
    const ratingCount = Number(data?.ratingCount || 0);

    if (ratingCount === 0) {
      modalRatingEl.innerText = "☆☆☆☆☆ (0 reviews)";
      if (latestReviewsEl) {
        latestReviewsEl.innerHTML = "";
      }
      return;
    }

    modalRatingEl.innerText = `${renderStars(averageRating)} ${averageRating.toFixed(1)}/5 (${ratingCount} review${ratingCount === 1 ? "" : "s"})`;

    if (latestReviewsEl) {
      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
      if (reviews.length === 0) {
        latestReviewsEl.innerHTML = "";
      } else {
        latestReviewsEl.innerHTML = `
          <div style="margin-top:10px; border-top:1px solid rgba(255,255,255,0.08); padding-top:10px;">
            <p style="font-size:12px; color:#9ca3af; margin-bottom:8px;">Latest Reviews</p>
            ${reviews.map((review) => {
              const reviewStars = renderStars(review.rating || 0);
              const dateText = review.createdAt ? new Date(review.createdAt).toLocaleDateString() : "";
              return `
                <div style="background:#111827; border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px; margin-bottom:8px;">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
                    <p style="margin:0; font-size:12px; color:#e5e7eb; font-weight:700;">${review.userName || "User"}</p>
                    <span style="font-size:10px; padding:3px 8px; border-radius:999px; background:rgba(22,163,74,0.15); color:#16a34a; font-weight:700;">Verified Purchase</span>
                  </div>
                  <p style="margin:0 0 4px; font-size:12px; color:#f59e0b;">${reviewStars}</p>
                  <p style="margin:0; font-size:12px; color:#d1d5db; line-height:1.4;">${String(review.comment || "")}</p>
                  <p style="margin:6px 0 0; font-size:10px; color:#6b7280;">${dateText}</p>
                </div>
              `;
            }).join("")}
          </div>
        `;
      }
    }
  } catch (error) {
    modalRatingEl.innerText = "Rating unavailable";
    if (latestReviewsEl) {
      latestReviewsEl.innerHTML = "";
    }
  }
}

function closeModal() {
  const modalEl = document.getElementById("modal");
  if (!modalEl) return;

  modalEl.style.display = "none";
  modalEl.setAttribute("aria-hidden", "true");

  if (_lastFocusedBeforeModal && typeof _lastFocusedBeforeModal.focus === "function") {
    _lastFocusedBeforeModal.focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const modalEl = document.getElementById("modal");
  if (!modalEl) return;

  modalEl.setAttribute("role", "dialog");
  modalEl.setAttribute("aria-modal", "true");
  modalEl.setAttribute("aria-labelledby", "modalTitle");
  modalEl.setAttribute("aria-hidden", "true");

  const closeBtn = modalEl.querySelector(".close");
  if (closeBtn) {
    closeBtn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeModal();
      }
    });
  }

  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalEl.style.display === "flex") {
      closeModal();
    }
  });
});

async function loadRecommendations(productName) {
  // Legacy function — now handled by RecommendationEngine
  if (typeof RecommendationEngine !== 'undefined') {
    RecommendationEngine.loadProductRecommendations(productName, '', '');
    return;
  }
  try {
    const res = await fetch("http://localhost:5000/api/products");
    const products = await res.json();

    const recDiv = document.getElementById("recommendations");
    recDiv.innerHTML = "";

    // simple similarity by name match (temporary AI)
    const filtered = products.filter((p) => p.name !== productName).slice(0, 4);

    filtered.forEach((p) => {
      recDiv.innerHTML += `
        <div style="border:1px solid #ddd; padding:8px; margin:5px;">
          <p><b>${p.name}</b></p>
          <p>₹${p.price}</p>
        </div>
      `;
    });
  } catch (err) {
    console.log("Recommendation error:", err);
  }
}

async function aiSearch() {
  const query = document.getElementById("searchInput").value.trim();

  if (!query) return;

  try {
    const res = await fetch(
      "http://localhost:5000/api/products/search-products",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );

    const data = await res.json();

    const resultDiv = document.getElementById("searchResults");

    resultDiv.innerHTML = "";

    if (!data.length) {
      resultDiv.innerHTML += "<p>No products found.</p>";

      return;
    }

    data.forEach((p) => {
      resultDiv.innerHTML += `
  
  <div class="search-item" onclick="openModal('${p.name}','₹${p.price}','${p.description}','[]','${p.image}')">

      <img src="imgs/${p.image}" class="search-img"
      onerror="this.src='https://via.placeholder.com/60'">

      <div class="search-divider"></div>

      <div class="search-info">

          <div class="search-name">${p.name}</div>

          <div class="search-desc">${p.description || ""}</div>

          <div class="search-price">₹${p.price}</div>

      </div>

  </div>

  `;
    });
  } catch (err) {
    console.log("Search error:", err);
  }
}
