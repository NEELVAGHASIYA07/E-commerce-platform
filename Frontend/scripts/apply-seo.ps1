$ErrorActionPreference = "Stop"
Set-Location "d:\new"

$baseUrl = "https://www.romuyks.com"
$ogImage = "$baseUrl/imgs/unnamed.png"

function Escape-Attr([string]$value) {
  if ($null -eq $value) { return "" }
  return $value.Replace("&", "&amp;").Replace('"', "&quot;").Replace("<", "&lt;").Replace(">", "&gt;")
}

$seoMap = [ordered]@{
  "1.index.html" = @{ title = "Romuyks | Future. Defined."; description = "Discover Romuyks for fashion, beauty, home essentials, and electronics with fast delivery, secure checkout, and trusted support."; robots = "index, follow"; canonical = "$baseUrl/1.index.html"; jsonld = $true }
  "2.about.html" = @{ title = "Romuyks | About"; description = "Learn about Romuyks, our mission, and how we deliver quality products with reliable service and customer-first support."; robots = "index, follow"; canonical = "$baseUrl/2.about.html"; jsonld = $false }
  "3.products.html" = @{ title = "Romuyks | Products"; description = "Browse all Romuyks products across fashion, beauty, home essentials, and more. Find top deals and new arrivals."; robots = "index, follow"; canonical = "$baseUrl/3.products.html"; jsonld = $false }
  "4.shop.html" = @{ title = "Romuyks | Shop"; description = "Shop curated products on Romuyks with smart search, filters, and fast checkout for a seamless online shopping experience."; robots = "index, follow"; canonical = "$baseUrl/4.shop.html"; jsonld = $false }
  "5.contact.html" = @{ title = "Romuyks | Contact"; description = "Contact Romuyks support for order help, account questions, shipping updates, and marketplace assistance."; robots = "index, follow"; canonical = "$baseUrl/5.contact.html"; jsonld = $false }
  "privacy-policy.html" = @{ title = "Romuyks | Privacy Policy"; description = "Read the Romuyks Privacy Policy to understand how we collect, use, and protect your personal information."; robots = "index, follow"; canonical = "$baseUrl/privacy-policy.html"; jsonld = $false }
  "terms-of-service.html" = @{ title = "Romuyks | Terms of Service"; description = "Read the Romuyks Terms of Service for account usage rules, order policies, and legal terms."; robots = "index, follow"; canonical = "$baseUrl/terms-of-service.html"; jsonld = $false }
  "shipping-policy.html" = @{ title = "Romuyks | Shipping Policy"; description = "Review Romuyks shipping timelines, delivery methods, and location coverage before placing your order."; robots = "index, follow"; canonical = "$baseUrl/shipping-policy.html"; jsonld = $false }
  "returns-policy.html" = @{ title = "Romuyks | Returns Policy"; description = "Understand Romuyks return, replacement, and refund policy including eligibility and timelines."; robots = "index, follow"; canonical = "$baseUrl/returns-policy.html"; jsonld = $false }
  "help-center.html" = @{ title = "Romuyks | Help Center"; description = "Visit the Romuyks Help Center for FAQs, support channels, and quick solutions for orders and accounts."; robots = "index, follow"; canonical = "$baseUrl/help-center.html"; jsonld = $false }
  "6.cart.html" = @{ title = "Romuyks | Your Cart"; description = "Review your Romuyks cart, update quantities, and proceed to secure checkout."; robots = "noindex, nofollow"; canonical = "$baseUrl/6.cart.html"; jsonld = $false }
  "7.orders.html" = @{ title = "Romuyks | Orders"; description = "Track and manage your Romuyks orders, invoices, and delivery updates."; robots = "noindex, nofollow"; canonical = "$baseUrl/7.orders.html"; jsonld = $false }
  "8.auth.html" = @{ title = "Romuyks | Sign In"; description = "Sign in or create your Romuyks account to access orders, wishlist, and faster checkout."; robots = "noindex, nofollow"; canonical = "$baseUrl/8.auth.html"; jsonld = $false }
  "9.dashboard.html" = @{ title = "Romuyks | Dashboard"; description = "Manage your Romuyks account, profile, and recent activity from your dashboard."; robots = "noindex, nofollow"; canonical = "$baseUrl/9.dashboard.html"; jsonld = $false }
  "wishlist.html" = @{ title = "Romuyks | Wishlist"; description = "View and manage products saved to your Romuyks wishlist."; robots = "noindex, nofollow"; canonical = "$baseUrl/wishlist.html"; jsonld = $false }
  "profile-settings.html" = @{ title = "Romuyks | Profile Settings"; description = "Update your Romuyks profile, preferences, and account settings."; robots = "noindex, nofollow"; canonical = "$baseUrl/profile-settings.html"; jsonld = $false }
  "new.html" = @{ title = "Romuyks | Payment"; description = "Complete your Romuyks payment securely and confirm your order details."; robots = "noindex, nofollow"; canonical = "$baseUrl/new.html"; jsonld = $false }
  "test.html" = @{ title = "Romuyks | Test Page"; description = "Romuyks test and preview page."; robots = "noindex, nofollow"; canonical = "$baseUrl/test.html"; jsonld = $false }
  "contact-page.html" = @{ title = "Romuyks | Contact Us"; description = "Contact Romuyks support team for assistance and inquiries."; robots = "noindex, nofollow"; canonical = "$baseUrl/contact-page.html"; jsonld = $false }
}

foreach ($file in $seoMap.Keys) {
  $path = Join-Path (Get-Location) $file
  if (-not (Test-Path $path)) {
    Write-Host "Skipped missing $file"
    continue
  }

  $meta = $seoMap[$file]
  $content = [System.IO.File]::ReadAllText($path)

  $content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    "\s*<!-- SEO META START -->.*?<!-- SEO META END -->\s*",
    "`r`n",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  $titleEsc = Escape-Attr([string]$meta.title)
  $descEsc = Escape-Attr([string]$meta.description)
  $robotsEsc = Escape-Attr([string]$meta.robots)
  $canonicalEsc = Escape-Attr([string]$meta.canonical)
  $urlEsc = $canonicalEsc
  $ogImageEsc = Escape-Attr($ogImage)

  $content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    "<title>.*?</title>",
    "<title>$titleEsc</title>",
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  $seoBlock = @"
  <!-- SEO META START -->
  <meta name="description" content="$descEsc" />
  <meta name="robots" content="$robotsEsc" />
  <link rel="canonical" href="$canonicalEsc" />
  <meta property="og:site_name" content="Romuyks" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="$titleEsc" />
  <meta property="og:description" content="$descEsc" />
  <meta property="og:url" content="$urlEsc" />
  <meta property="og:image" content="$ogImageEsc" />
  <meta property="og:image:alt" content="Romuyks online marketplace" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="$titleEsc" />
  <meta name="twitter:description" content="$descEsc" />
  <meta name="twitter:image" content="$ogImageEsc" />
  <meta name="theme-color" content="#0b1220" />
"@

  if ($meta.jsonld -eq $true) {
    $seoBlock += @"

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Romuyks",
    "url": "$baseUrl/",
    "potentialAction": {
      "@type": "SearchAction",
      "target": "$baseUrl/4.shop.html?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Romuyks",
    "url": "$baseUrl/",
    "logo": "$ogImageEsc"
  }
  </script>
"@
  }

  $seoBlock += @"

  <!-- SEO META END -->
"@

  $titleCloseIndex = $content.IndexOf("</title>", [System.StringComparison]::OrdinalIgnoreCase)
  if ($titleCloseIndex -lt 0) {
    throw "No </title> found in $file"
  }

  $insertIndex = $titleCloseIndex + 8
  $content = $content.Insert($insertIndex, "`r`n$seoBlock")

  [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Updated $file"
}
