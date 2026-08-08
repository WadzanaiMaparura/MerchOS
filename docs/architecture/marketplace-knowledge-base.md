# MerchOS Marketplace Knowledge Base

> **Version:** 1.0  
> **Status:** Living Document  
> **Last Updated:** 2025-01  
> **Verification Status:** Draft — requires verification against current platform templates

This document is the authoritative reference for marketplace-specific product requirements across all five supported platforms. It documents field requirements, validation rules, export formats, and platform-specific behaviours that the MerchOS Schema Registry and Validation Engine must enforce.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Takealot](#2-takealot)
3. [Makro](#3-makro)
4. [Amazon](#4-amazon)
5. [Shopify](#5-shopify)
6. [WooCommerce](#6-woocommerce)
7. [Cross-Platform Comparison](#7-cross-platform-comparison)
8. [Verification Log](#8-verification-log)

---

## 1. Overview

### 1.1 Purpose

This knowledge base captures the complete field-level requirements for each marketplace platform that MerchOS exports to. It serves as the source material for populating the Schema Registry and defining validation rules in the Validation Engine.

### 1.2 Platforms

| Platform | Region | Export Method | Category System |
|----------|--------|--------------|-----------------|
| Takealot | South Africa | CSV / API | Flat category + Bulk Offers |
| Makro | South Africa | Vertical-specific loadsheets (CSV) | Vertical/category loadsheets |
| Amazon | Global (multiple marketplaces) | Flat file templates / SP-API | Product-type hierarchical |
| Shopify | Global | CSV / Admin API / Storefront API | Product category + product type |
| WooCommerce | Global (self-hosted) | CSV / REST API | Categories + tags (hierarchical) |

### 1.3 Conventions Used in This Document

- **REQUIRED** — Field must be populated for successful submission
- **CONDITIONAL** — Required only under certain conditions (documented per field)
- **OPTIONAL** — Field is supported but not mandatory
- **REQUIRES VERIFICATION** — Requirement sourced from general documentation; needs confirmation against current live templates
- **PLATFORM-GENERATED** — Field is generated/assigned by the platform, not submitted by sellers

---

## 2. Takealot

### 2.1 Platform Overview

Takealot is South Africa's largest online retailer operating as a marketplace where third-party sellers list products alongside Takealot's own inventory. Sellers manage products through Seller Portal and submit product data via structured templates.

**Key terminology:**
- **TSIN** — Takealot Stock Identification Number (platform-generated product identifier)
- **Offer** — A seller's listing against an existing TSIN (price, stock, leadtime)
- **Barcode** — Primary product identifier (EAN/UPC/ISBN); must be globally unique
- **SKU** — Seller's internal stock-keeping unit identifier
- **SoH** — Stock on Hand (inventory quantity)
- **RRP** — Recommended Retail Price
- **Leadtime** — Days from order to dispatch

### 2.2 Workflow Distinction

> **IMPORTANT:** Takealot has TWO distinct workflows that MerchOS must support:

| Workflow | Purpose | Template |
|----------|---------|----------|
| **Product/Listing Creation** | Submit NEW products to the Takealot catalogue | Full product template (category-dependent) |
| **Bulk Offers** | Update price, stock, and leadtime for EXISTING catalogue products | Bulk Offers spreadsheet (6 fields) |

The **Bulk Offers template is NOT the complete catalogue schema**. It covers commercial/listing updates only. Full product creation requires a separate, more comprehensive template with content fields.

### 2.3 Bulk Offers Fields

The Bulk Offers template is the minimum required for updating commercial data on existing Takealot listings:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Barcode | String (EAN-13/UPC-A/ISBN-13) | REQUIRED | Product barcode; must match existing catalogue TSIN |
| SKU | String | REQUIRED | Seller's internal SKU reference |
| My SoH | Integer (≥0) | REQUIRED | Current stock on hand quantity |
| Selling Price | Decimal (ZAR) | REQUIRED | Seller's selling price in South African Rand |
| RRP | Decimal (ZAR) | REQUIRED | Recommended retail price |
| Leadtime | Integer (days) | REQUIRED | Days from order placement to dispatch readiness |

### 2.4 Product Creation Fields (Full Catalogue)

> **REQUIRES VERIFICATION** — Full product creation templates vary by category. The fields below represent the common baseline observed in Takealot Seller Portal documentation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Product Title | String (max ~150 chars) | REQUIRED | Product name as displayed on Takealot |
| Barcode | String (EAN-13/UPC-A/ISBN-13) | REQUIRED | Unique product barcode |
| SKU | String | REQUIRED | Seller's internal SKU |
| Brand | String | REQUIRED | Product brand name |
| Description | HTML/Text | REQUIRED | Product description (supports basic HTML) |
| Category | String | REQUIRED | Takealot category path |
| Images | URL(s) | REQUIRED | Product images (minimum 1, recommended 3+) |
| Selling Price | Decimal (ZAR) | REQUIRED | Selling price |
| RRP | Decimal (ZAR) | REQUIRED | Recommended retail price |
| Stock on Hand | Integer | REQUIRED | Initial stock quantity |
| Leadtime | Integer (days) | REQUIRED | Dispatch leadtime |
| Weight (kg) | Decimal | CONDITIONAL | Required for shipping calculation |
| Dimensions (L×W×H cm) | Decimal | CONDITIONAL | Required for shipping calculation |
| Warranty | String | CONDITIONAL | Warranty period (category-dependent) |
| Colour | String | CONDITIONAL | Product colour (category-dependent) |
| Size | String | CONDITIONAL | Product size (category-dependent) |

### 2.5 Identifier Requirements

| Identifier | Format | Validation Rule |
|------------|--------|-----------------|
| EAN-13 | 13 digits | Check digit validated (mod-10 algorithm) |
| UPC-A | 12 digits | Check digit validated (mod-10 algorithm) |
| ISBN-13 | 13 digits (978/979 prefix) | Check digit validated (mod-10 algorithm) |
| ISBN-10 | 10 characters | Legacy; convert to ISBN-13 for submission |
| SKU | Alphanumeric (seller-defined) | Must be unique within seller's catalogue |

### 2.6 Image Requirements

- Minimum 1 image required; recommended 3+ images
- Supported formats: JPEG, PNG
- Minimum resolution: 500×500 pixels (REQUIRES VERIFICATION)
- White background preferred for main image
- Images submitted as URLs (must be publicly accessible at time of processing)
- Image ordering: first image is the primary/hero image

### 2.7 Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| Barcode format valid | ERROR | Must be valid EAN-13, UPC-A, or ISBN-13 with correct check digit |
| Barcode unique in catalogue | ERROR | Barcode must not already exist under a different TSIN (for new products) |
| Selling Price ≤ RRP | WARNING | Platform may flag if selling price exceeds RRP |
| Stock on Hand ≥ 0 | ERROR | Negative stock not permitted |
| Leadtime > 0 | ERROR | Must be at least 1 day |
| Title length | ERROR | Must not exceed platform maximum (REQUIRES VERIFICATION: ~150 chars) |
| At least 1 image | ERROR | Products without images are rejected |
| Price > 0 | ERROR | Zero or negative price not permitted |

### 2.8 Variant/Parent-Child Relationships

Takealot uses a TSIN-based variant system:
- Parent TSIN represents the product family
- Child TSINs represent individual variants (colour, size, etc.)
- Variants share the same product page on Takealot
- Each variant has its own unique barcode
- Variant attributes: typically Colour, Size (REQUIRES VERIFICATION for full list)

### 2.9 Commercial Notes

- **Price is REQUIRED** by Takealot even for product creation — MerchOS maintains commercial data alongside content data
- Takealot controls final retail pricing decisions (sellers submit offers, Takealot may adjust display)
- Commission structure varies by category (not relevant to export but affects seller pricing strategy)

### 2.10 Export Format

- **Bulk Offers:** CSV (comma-separated), UTF-8 encoding, with header row
- **Product Creation:** XLSX template (category-specific) — REQUIRES VERIFICATION for exact format
- Column ordering must match template exactly
- No extra columns permitted in submission files

### 2.11 Rejection/Error Handling

Common rejection reasons from Takealot:
- Invalid or duplicate barcode
- Missing required fields
- Image URLs not accessible
- Price/RRP inconsistencies
- Category-specific field violations
- Trademark/brand verification failures

### 2.12 Source Documentation

| Source | URL | Status |
|--------|-----|--------|
| Takealot Seller Portal | https://seller.takealot.com | REQUIRES VERIFICATION |
| Takealot Seller API Documentation | https://developer.takealot.com | REQUIRES VERIFICATION |
| Bulk Offers Template | Available via Seller Portal download | Verified (template obtained) |

---

## 3. Makro

### 3.1 Platform Overview

Makro Marketplace (South Africa) operates a vertical-specific loadsheet system where product data requirements vary significantly by category/vertical. Sellers submit products via loadsheets — structured spreadsheets with fields determined by the product's assigned vertical.

**Key terminology:**
- **Loadsheet** — Category-specific spreadsheet template for product submission
- **Vertical** — Product category/classification (e.g., Electronics, Bedding, Furniture)
- **QC** — Quality Check; Makro's review process after loadsheet submission
- **PLU** — Price Look-Up code (platform-generated identifier)
- **Barcode** — EAN/UPC product identifier

### 3.2 Vertical-Specific Loadsheet System

> **CRITICAL:** Makro loadsheets are NOT uniform across categories. Each vertical has its own loadsheet template with different required fields, attribute columns, and validation rules.

| Vertical Example | Loadsheet Characteristics |
|-----------------|---------------------------|
| Duvet Covers / Bedding | Thread count, material, size (Single/Double/Queen/King), colour, fill type |
| Electronics | Wattage, voltage, connectivity, warranty, certifications |
| Furniture | Dimensions, material, weight capacity, assembly required, colour |
| Appliances | Energy rating, capacity, voltage, warranty |
| Fashion | Size, colour, material, gender, age group |

### 3.3 Field Classification

Makro loadsheet fields fall into distinct categories that MerchOS must distinguish:

| Classification | Description | MerchOS Handling |
|---------------|-------------|------------------|
| **Seller Input Fields** | Fields the seller must populate (title, description, barcode, price, attributes) | Mapped from canonical product model |
| **Platform-Generated Fields** | Fields assigned by Makro (PLU, listing status, QC status) | Not exported; tracked for reference |
| **QC/Status Fields** | Quality check outcome, rejection reasons, review status | Mapped back as validation feedback |
| **Listing/Commercial Fields** | Price, stock, availability, fulfilment method | Mapped from commercial data |
| **Category-Specific Attributes** | Vertical-dependent attribute columns | Selected based on vertical mapping |

### 3.4 Common Fields (All Verticals)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Product Title | String | REQUIRED | Product name/title |
| Barcode (EAN/UPC) | String (13 digits) | REQUIRED | Unique product barcode |
| Brand | String | REQUIRED | Product brand |
| Short Description | String | REQUIRED | Brief product description |
| Long Description | Text/HTML | REQUIRED | Detailed product description |
| Category/Vertical | String | REQUIRED | Makro vertical classification |
| Selling Price (ZAR) | Decimal | REQUIRED | Selling price including VAT |
| RRP (ZAR) | Decimal | CONDITIONAL | Recommended retail price |
| Stock Quantity | Integer | REQUIRED | Available stock |
| Main Image URL | URL | REQUIRED | Primary product image |
| Additional Images | URL(s) | OPTIONAL | Secondary product images |
| Weight (kg) | Decimal | REQUIRED | Product weight for shipping |
| Dimensions (L×W×H cm) | Decimal | REQUIRED | Package dimensions |
| SKU | String | REQUIRED | Seller's SKU reference |
| Warranty | String | CONDITIONAL | Warranty period (vertical-dependent) |

### 3.5 Category-Specific Fields (Examples)

#### Duvet Covers / Bedding Vertical

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| Size | Enum | REQUIRED | Single, Three Quarter, Double, Queen, King, Super King |
| Material / Fabric | String | REQUIRED | e.g., Cotton, Polyester, Microfibre, Polycotton |
| Thread Count | Integer | CONDITIONAL | Numeric thread count (where applicable) |
| Fill Type | String | CONDITIONAL | Hollow Fibre, Down, Feather, Synthetic |
| Colour | String | REQUIRED | Product colour |
| Pattern | String | OPTIONAL | Pattern description |
| Pieces in Set | Integer | CONDITIONAL | Number of items in set |

#### Electronics Vertical

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| Wattage | String | CONDITIONAL | Power consumption |
| Voltage | String | CONDITIONAL | Operating voltage (e.g., 220-240V) |
| Connectivity | String | CONDITIONAL | WiFi, Bluetooth, USB, etc. |
| Warranty Period | String | REQUIRED | e.g., 1 Year, 2 Years |
| Certification | String | CONDITIONAL | SABS, CE, etc. |
| Model Number | String | REQUIRED | Manufacturer's model number |
| Colour | String | CONDITIONAL | Product colour |

#### Furniture Vertical

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| Material | String | REQUIRED | Wood, Metal, Fabric, Leather, etc. |
| Colour/Finish | String | REQUIRED | Product colour or finish |
| Assembly Required | Boolean/String | REQUIRED | Yes/No |
| Max Weight Capacity (kg) | Decimal | CONDITIONAL | Maximum supported weight |
| Seating Capacity | Integer | CONDITIONAL | Number of seats (for seating furniture) |
| Indoor/Outdoor | Enum | CONDITIONAL | Indoor, Outdoor, Both |

### 3.6 Identifier Requirements

| Identifier | Format | Validation Rule |
|------------|--------|-----------------|
| EAN-13 | 13 digits | Check digit validation required |
| UPC-A | 12 digits | Check digit validation required |
| SKU | Alphanumeric | Unique within seller account |
| PLU | Platform-assigned | Not submitted by seller |

### 3.7 Image Requirements

- Minimum 1 image required (main image)
- Recommended 3-5 images
- Images submitted as URLs (must be publicly accessible)
- White background preferred for main image
- Minimum resolution: REQUIRES VERIFICATION
- Supported formats: JPEG, PNG
- Image ordering: first URL is primary image

### 3.8 Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| Barcode format valid (EAN-13/UPC-A) | ERROR | Must pass check digit validation |
| All required fields for vertical populated | ERROR | Vertical-specific required fields must be present |
| Price > 0 | ERROR | Positive price required |
| Stock ≥ 0 | ERROR | Non-negative stock |
| Image URL accessible | ERROR | Main image must resolve to valid image |
| Dimensions provided | ERROR | L, W, H all required |
| Weight provided | ERROR | Shipping weight required |
| Allowed values respected | ERROR | Enum fields must use permitted values |
| Title length appropriate | WARNING | REQUIRES VERIFICATION for exact limits |
| Description not empty | ERROR | Both short and long descriptions required |

### 3.9 Validation Before Loadsheet Generation

> **ARCHITECTURAL NOTE:** MerchOS must validate product data against the vertical-specific schema BEFORE generating the loadsheet file. The validation report must identify:
> - Missing required fields for the target vertical
> - Invalid values for enum/constrained fields
> - Barcode format errors
> - Image accessibility issues

This prevents submission of invalid loadsheets that would be rejected in Makro's QC process.

### 3.10 QC/Rejection Feedback Mapping

After loadsheet submission, Makro performs QC review. Common rejection reasons must map back to MerchOS validation rules:

| Makro Rejection | Maps To | MerchOS Action |
|-----------------|---------|----------------|
| Missing required attribute | Validation ERROR — required field | Add field to vertical schema as REQUIRED |
| Invalid barcode | Barcode validation ERROR | Enforce check digit validation |
| Image quality insufficient | Image validation WARNING/ERROR | Add image quality checks |
| Price inconsistency | Price validation WARNING | Flag for user review |
| Category mismatch | Vertical validation ERROR | Ensure correct vertical mapping |

### 3.11 Export Format

- **Format:** CSV (loadsheet structure) or XLSX — REQUIRES VERIFICATION for exact format per vertical
- **Encoding:** UTF-8
- **Column ordering:** Must match Makro's loadsheet template exactly per vertical
- **Header row:** Required; column names must match template
- **One product per row**
- No extra/unknown columns permitted

### 3.12 Import/Update Behaviour

- New products: Full loadsheet submission with all required fields
- Stock/price updates: Specific update templates (REQUIRES VERIFICATION)
- Product updates: Re-submission of loadsheet with changes (REQUIRES VERIFICATION on partial vs full)

### 3.13 Source Documentation

| Source | URL | Status |
|--------|-----|--------|
| Makro Marketplace Seller Portal | https://marketplace.makro.co.za | REQUIRES VERIFICATION |
| Makro Loadsheet Templates | Available via Seller Portal | Verified (templates obtained) |
| Makro Seller Documentation | Portal-internal documentation | REQUIRES VERIFICATION |

---

## 4. Amazon

### 4.1 Platform Overview

Amazon operates the world's largest e-commerce marketplace across multiple geographic marketplaces (US, UK, DE, JP, etc.). Amazon's product catalogue system is built on a hierarchical product-type classification where field requirements vary by product type. Sellers interact via Seller Central, flat file templates, or the SP-API (Selling Partner API).

**Key terminology:**
- **ASIN** — Amazon Standard Identification Number (platform-generated unique product ID)
- **Product Type** — Amazon's classification that determines required attributes (e.g., `SHIRT`, `LAPTOP_COMPUTER`)
- **Flat File** — Tab-separated template file for bulk product upload
- **Feed** — Data submission payload (XML or flat file) processed asynchronously
- **Processing Report** — Amazon's response detailing accepted/rejected items
- **Listing** — A seller's offer against a catalogue product (price, condition, fulfilment)
- **Item** — The catalogue product (content, attributes, images)
- **Browse Node** — Amazon's category tree node
- **Variation** — Parent/child product relationships (colour, size variants)

### 4.2 Workflow Distinction

Amazon distinguishes between creating a NEW catalogue product and creating an OFFER on an existing catalogue product:

| Workflow | Purpose | Requirements |
|----------|---------|--------------|
| **New Catalogue Product** | Create a product that doesn't exist in Amazon's catalogue | Full product data: product type, all required attributes, images, identifiers |
| **Offer on Existing Product** | Sell an existing ASIN | SKU, ASIN or product identifier, condition, price, quantity, fulfilment channel |

### 4.3 Product Classification

Amazon's schema requirements are **product-type dependent**. The product type determines:
- Which attributes are required, recommended, or optional
- Allowed values for enumerated fields
- Variation themes (which attributes define variants)
- Image requirements

> **ARCHITECTURAL NOTE:** Public Amazon documentation does not expose every live category template. MerchOS architecture must support importing actual Seller Central flat file templates as schema definitions. The Schema Registry must accommodate Amazon templates obtained directly from Seller Central downloads.

### 4.4 Common Required Fields (All Product Types)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| SKU | String (max 40 chars) | REQUIRED | Seller's unique product identifier |
| Product Type | Enum | REQUIRED | Amazon product type classification |
| Title | String (max 200 chars, varies by category) | REQUIRED | Product title |
| Brand | String | REQUIRED | Product brand name |
| Manufacturer | String | REQUIRED | Product manufacturer |
| Product ID (UPC/EAN/GTIN/ISBN) | String | REQUIRED | Product identifier (exemption possible) |
| Product ID Type | Enum | REQUIRED | UPC, EAN, GTIN, ISBN |
| Description | String (max 2000 chars) | REQUIRED | Product description |
| Bullet Points | String (up to 5, max 500 chars each) | REQUIRED | Key feature bullet points |
| Main Image URL | URL | REQUIRED | Primary product image |
| Price | Decimal | REQUIRED | Selling price (currency determined by marketplace) |
| Quantity | Integer | REQUIRED | Available stock |
| Condition | Enum | REQUIRED | New, Refurbished, Used — Like New, etc. |
| Fulfilment Channel | Enum | REQUIRED | MFN (Merchant Fulfilled) or AFN (Amazon Fulfilled / FBA) |

### 4.5 Category-Dependent Fields

> **REQUIRES VERIFICATION** — Exact fields vary by product type. Below are representative examples.

#### Clothing / Apparel

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Department | Enum | REQUIRED | Mens, Womens, Boys, Girls, Unisex |
| Colour | String | REQUIRED | Product colour |
| Colour Map | Enum | REQUIRED | Amazon's standardized colour mapping |
| Size | String | REQUIRED | Product size |
| Size Map | Enum | REQUIRED | Amazon's standardized size mapping |
| Material | String | RECOMMENDED | Fabric/material composition |
| Outer Material | String | CONDITIONAL | Outer material (for outerwear) |
| Closure Type | String | OPTIONAL | Zip, Button, Hook, etc. |

#### Electronics / Computers

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Model Number | String | REQUIRED | Manufacturer model number |
| Part Number | String | RECOMMENDED | Manufacturer part number |
| Wattage | Decimal | CONDITIONAL | Power consumption |
| Voltage | String | CONDITIONAL | Operating voltage |
| Connectivity | String | CONDITIONAL | WiFi, Bluetooth, USB, etc. |
| Operating System | String | CONDITIONAL | For computers/tablets |
| Screen Size | Decimal | CONDITIONAL | Display size in inches |
| Storage Capacity | String | CONDITIONAL | Hard drive/SSD capacity |
| RAM | String | CONDITIONAL | Memory capacity |

### 4.6 Identifier Requirements

| Identifier | Format | Notes |
|------------|--------|-------|
| UPC | 12 digits | Standard US product identifier |
| EAN | 13 digits | Standard international product identifier |
| GTIN | 14 digits | Global Trade Item Number |
| ISBN | 10 or 13 digits | Books and publications |
| ASIN | 10 characters (Amazon-assigned) | Not submitted; assigned by Amazon |
| GCID | Amazon-assigned | Brand Registry identifier (alternative to UPC/EAN) |

**Exemptions:** Products without standard identifiers may apply for a GTIN exemption (per-category basis). REQUIRES VERIFICATION for current exemption process.

### 4.7 Variation Relationships

Amazon uses a **parent-child variation model**:
- **Parent listing:** Virtual product (not purchasable) that groups variants
- **Child listings:** Individual purchasable variants
- **Variation Theme:** Defines which attributes differentiate children (e.g., SizeColor, Size, Color)
- Parent provides shared content (title, description, brand); children inherit and override specific attributes

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Parentage | Enum | REQUIRED (for variants) | parent or child |
| Parent SKU | String | REQUIRED (for children) | SKU of the parent listing |
| Relationship Type | Enum | REQUIRED | Variation |
| Variation Theme | Enum | REQUIRED | SizeColor, Size, Color, etc. |

### 4.8 Image Requirements

- **Main image:** REQUIRED, pure white background (RGB 255,255,255), product fills 85%+ of frame
- **Additional images:** Up to 8 additional images (total 9 including main)
- **Minimum resolution:** 1000×1000 pixels (for zoom functionality)
- **Maximum file size:** 10 MB per image
- **Supported formats:** JPEG (.jpg), PNG, GIF, TIFF
- **Naming:** No specific naming convention required for URL submission
- **Swatch image:** Optional colour swatch (for colour variants)
- Images submitted as URLs — must be publicly accessible HTTPS URLs

### 4.9 Commercial/Listing Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Standard Price | Decimal | REQUIRED | Listing price |
| Sale Price | Decimal | OPTIONAL | Promotional sale price |
| Sale Start Date | Date | CONDITIONAL | Required if sale price set |
| Sale End Date | Date | CONDITIONAL | Required if sale price set |
| Currency | Enum | REQUIRED | Determined by marketplace (USD, GBP, EUR, etc.) |
| Quantity | Integer | REQUIRED | Available stock |
| Handling Time (days) | Integer | CONDITIONAL | Days to ship (MFN only) |
| Condition Type | Enum | REQUIRED | New, Refurbished, Used |
| Condition Note | String | CONDITIONAL | Required for non-New condition |
| Max Order Quantity | Integer | OPTIONAL | Maximum units per order |

### 4.10 Feed/Template Versioning

- Amazon periodically updates flat file template versions
- Templates are marketplace-specific (different versions per marketplace)
- Processing reports reference the template version used
- MerchOS Schema Registry must track template version per marketplace per product type

### 4.11 Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| Product identifier valid (UPC/EAN check digit) | ERROR | Must pass check digit validation |
| All required fields for product type populated | ERROR | Product-type-specific required fields |
| Title length within limit | ERROR | Varies by category (typically 200 chars max) |
| Bullet points count ≤ 5 | ERROR | Maximum 5 bullet points |
| Main image present | ERROR | At least one image required |
| Image meets resolution minimum | WARNING | 1000×1000 recommended |
| Price > 0 | ERROR | Positive price required |
| Quantity ≥ 0 | ERROR | Non-negative stock |
| SKU unique within seller account | ERROR | No duplicate SKUs |
| Variation theme valid for product type | ERROR | Must use allowed variation theme |
| Parent SKU exists (for child listings) | ERROR | Child must reference valid parent |
| Condition valid for category | ERROR | Some categories restrict condition types |

### 4.12 Rejection/Error Handling (Processing Reports)

Amazon returns processing reports with per-item results:

| Status | Meaning |
|--------|---------|
| Success | Item accepted into catalogue |
| Warning | Item accepted with warnings (e.g., non-standard values) |
| Error | Item rejected; specific error code and message provided |

Common error categories:
- Missing required attribute for product type
- Invalid product identifier (check digit, format)
- Duplicate ASIN conflict
- Brand not enrolled (Brand Registry requirement)
- Image requirements not met
- Restricted category/product (approval required)
- Value not in allowed enumeration

### 4.13 Export Format

- **Flat File:** Tab-separated (.tsv / .txt), UTF-8 encoding
- **Header rows:** Template includes metadata headers (template type, version) and field headers
- **One product per row**
- **Feed via API:** XML or JSON payload (SP-API Listings API)
- Column ordering must match template definition exactly
- Template version must match current marketplace version

### 4.14 Import/Update Behaviour

| Feed Type | Behaviour |
|-----------|-----------|
| Update | Modifies specified fields only; unspecified fields remain unchanged |
| PartialUpdate | Updates only provided attributes |
| Delete | Removes the listing (not the catalogue product) |

### 4.15 Source Documentation

| Source | URL | Status |
|--------|-----|--------|
| Amazon Seller Central Help | https://sellercentral.amazon.com/help | Available |
| SP-API Documentation | https://developer-docs.amazon.com/sp-api/ | Available |
| Product Type Definitions API | SP-API endpoint | Available |
| Flat File Templates | Seller Central > Inventory > Add Products via Upload | REQUIRES VERIFICATION (must download per category) |
| Amazon Brand Registry | https://brandregistry.amazon.com | Available |

> **NOTE:** Public documentation provides the API/schema framework, but actual category-specific flat file templates must be downloaded from Seller Central. The MerchOS architecture must support importing these templates as schema definitions.

---

## 5. Shopify

### 5.1 Platform Overview

Shopify is a global e-commerce platform enabling merchants to create online stores. Unlike Takealot/Makro/Amazon (which are marketplaces), Shopify stores are independently operated by merchants. Products are managed through the Shopify Admin, Admin API, or CSV import. Shopify's product model uses a handle-based system with variants, options, and metafields.

**Key terminology:**
- **Handle** — URL-friendly product identifier (auto-generated from title or manually set)
- **Variant** — A specific purchasable version of a product (combination of options like size/colour)
- **Option** — A product attribute that creates variants (up to 3 options per product)
- **Metafield** — Custom data field for extending the default product schema
- **Collection** — A grouping of products (manual or automated)
- **Product Type** — Merchant-defined product classification string
- **Product Category** — Shopify's standardized taxonomy (maps to Google Product Category)
- **Tags** — Comma-separated labels for organization and filtering
- **Vendor** — Brand/manufacturer/supplier name

### 5.2 Product Fields

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| Handle | String (URL-safe) | REQUIRED | Handle | URL slug; identifies the product |
| Title | String | REQUIRED | Title | Product name |
| Body HTML | HTML | OPTIONAL | Body (HTML) | Product description (supports HTML) |
| Vendor | String | OPTIONAL | Vendor | Brand or vendor name |
| Product Category | Standardized taxonomy | OPTIONAL | Product Category | Shopify standardized category |
| Type | String | OPTIONAL | Type | Merchant-defined product type |
| Tags | Comma-separated string | OPTIONAL | Tags | Product tags for organization |
| Published | Boolean | OPTIONAL | Published | Whether product is visible on storefront |
| Option1 Name | String | CONDITIONAL | Option1 Name | First variant option name (e.g., "Size") |
| Option1 Value | String | CONDITIONAL | Option1 Value | First variant option value (e.g., "Medium") |
| Option2 Name | String | OPTIONAL | Option2 Name | Second variant option name |
| Option2 Value | String | OPTIONAL | Option2 Value | Second variant option value |
| Option3 Name | String | OPTIONAL | Option3 Name | Third variant option name |
| Option3 Value | String | OPTIONAL | Option3 Value | Third variant option value |
| Variant SKU | String | OPTIONAL | Variant SKU | SKU for the variant |
| Variant Grams | Integer | OPTIONAL | Variant Grams | Weight in grams |
| Variant Inventory Tracker | String | OPTIONAL | Variant Inventory Tracker | Inventory tracking service (e.g., "shopify") |
| Variant Inventory Qty | Integer | OPTIONAL | Variant Inventory Qty | Stock quantity (legacy; use inventory API) |
| Variant Inventory Policy | Enum | OPTIONAL | Variant Inventory Policy | "deny" or "continue" (overselling) |
| Variant Fulfillment Service | String | OPTIONAL | Variant Fulfillment Service | "manual" or custom service handle |
| Variant Price | Decimal | REQUIRED | Variant Price | Selling price |
| Variant Compare At Price | Decimal | OPTIONAL | Variant Compare At Price | Original/compare price (for showing discount) |
| Variant Requires Shipping | Boolean | OPTIONAL | Variant Requires Shipping | Whether shipping is required |
| Variant Taxable | Boolean | OPTIONAL | Variant Taxable | Whether tax is charged |
| Variant Barcode | String | OPTIONAL | Variant Barcode | EAN/UPC/ISBN barcode |
| Image Src | URL | OPTIONAL | Image Src | Product image URL |
| Image Position | Integer | OPTIONAL | Image Position | Image display order (1-based) |
| Image Alt Text | String | OPTIONAL | Image Alt Text | Alt text for accessibility |
| Variant Image | URL | OPTIONAL | Variant Image | Image specific to this variant |
| Variant Weight Unit | Enum | OPTIONAL | Variant Weight Unit | g, kg, lb, oz |
| Variant Tax Code | String | OPTIONAL | Variant Tax Code | Tax code (Shopify Plus only) |
| SEO Title | String (max 70 chars) | OPTIONAL | SEO Title | Meta title for search engines |
| SEO Description | String (max 320 chars) | OPTIONAL | SEO Description | Meta description for search engines |
| Status | Enum | OPTIONAL | Status | active, draft, archived |

### 5.3 Identifier Requirements

| Identifier | Format | Notes |
|------------|--------|-------|
| Handle | URL-safe string | Auto-generated from title if not provided; must be unique per store |
| SKU | Free-form string | Unique per variant within store (recommended, not enforced) |
| Barcode | EAN-13/UPC-A/ISBN | Optional; no platform-level check digit validation on import |
| Product ID | Integer (Shopify-assigned) | Platform-generated; not submitted |
| Variant ID | Integer (Shopify-assigned) | Platform-generated; not submitted |

### 5.4 Variant/Option System

- Products can have up to **3 options** (e.g., Size, Colour, Material)
- Each combination of option values creates a variant
- Maximum **100 variants** per product
- Each variant has its own: SKU, barcode, price, compare-at price, weight, inventory, image
- Single-variant products: use "Title" as default option name with "Default Title" as value
- In CSV: each variant is a separate row sharing the same Handle

### 5.5 Image Requirements

- No strict minimum resolution (recommended 2048×2048 for zoom)
- Maximum file size: 20 MB per image
- Supported formats: JPEG, PNG, GIF, WebP
- Images submitted as URLs in CSV (must be publicly accessible)
- Image position determines display order (1 = primary)
- Alt text recommended for accessibility/SEO
- Variant-specific images supported (one per variant)
- Maximum images per product: 250

### 5.6 SEO Fields

| Field | Type | Max Length | Description |
|-------|------|-----------|-------------|
| SEO Title | String | 70 chars | Page title tag (meta title) |
| SEO Description | String | 320 chars | Meta description tag |
| Handle | String | — | URL slug (/products/{handle}) |

### 5.7 Metafields

Metafields extend the product schema with custom data. They are **store-specific** — each Shopify store defines its own metafields.

| Component | Description |
|-----------|-------------|
| Namespace | Grouping identifier (e.g., "custom", "my_fields") |
| Key | Field identifier within namespace |
| Value | Field value |
| Type | Data type (single_line_text_field, multi_line_text_field, number_integer, number_decimal, url, json, etc.) |

> **ARCHITECTURAL NOTE:** Metafields are store-specific configurations. MerchOS must support per-store metafield mapping as part of the Shopify adapter configuration. The Schema Registry stores metafield definitions per connected Shopify store.

### 5.8 Collections and Tags

- **Tags:** Comma-separated strings; used for filtering and automated collections
- **Collections:** Manual (hand-picked products) or Automated (rule-based on tags, type, vendor, price, etc.)
- **Product Type:** Free-form string for merchant's own classification
- **Product Category:** Shopify's standardized taxonomy (aligns with Google Product Category)

### 5.9 International/Market Fields

| Field | Description | Notes |
|-------|-------------|-------|
| Market-specific pricing | Per-market price overrides | Shopify Markets feature |
| Currency | Store's base currency | Set at store level |
| International pricing | Percentage adjustments or fixed prices per market | Store-specific configuration |
| Translations | Multi-language product content | Shopify Translate & Adapt app |

> **NOTE:** International/market fields are store-specific configurations. REQUIRES VERIFICATION for CSV import support of multi-market data.

### 5.10 Google Shopping Fields

Shopify supports Google Shopping integration fields (typically via metafields or Google channel app):

| Field | Type | Description |
|-------|------|-------------|
| Google Shopping Category | String | Google Product Category taxonomy |
| Gender | Enum | Male, Female, Unisex |
| Age Group | Enum | Adult, Kids, Toddler, Infant, Newborn |
| MPN | String | Manufacturer Part Number |
| Condition | Enum | New, Refurbished, Used |
| Custom Product | Boolean | Whether product is custom/made-to-order |
| GTIN | String | Global Trade Item Number |

### 5.11 Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| Handle unique per store | ERROR | No duplicate handles |
| Handle URL-safe format | ERROR | Only lowercase letters, numbers, hyphens |
| Variant Price present | ERROR | Each variant must have a price |
| Variant Price ≥ 0 | ERROR | Non-negative price |
| Maximum 3 options per product | ERROR | Cannot exceed 3 option axes |
| Maximum 100 variants per product | ERROR | Product variant limit |
| Image URL accessible | WARNING | Images should resolve at export time |
| SEO Title ≤ 70 chars | WARNING | May be truncated in search results |
| SEO Description ≤ 320 chars | WARNING | May be truncated in search results |
| Option values not empty | ERROR | Option values required when option name is set |
| Status valid | ERROR | Must be: active, draft, or archived |

### 5.12 Export Format (CSV)

- **Format:** CSV (comma-separated values)
- **Encoding:** UTF-8 (with or without BOM)
- **Header row:** Required; column names must match Shopify's expected headers exactly
- **Multi-variant products:** One row per variant; first row includes product-level data, subsequent rows include only Handle and variant-specific fields
- **Image rows:** Separate rows for additional images (same Handle, Image Src and Image Position populated)
- **Boolean values:** "true" / "false" (lowercase)
- **Published field:** "true" for published, "false" for unpublished
- **Empty fields:** Leave blank (do not use NULL or N/A)

### 5.13 Import/Update Behaviour

| Scenario | Behaviour |
|----------|-----------|
| New product (new Handle) | Creates product with all provided data |
| Existing Handle — Overwrite Products | Replaces all product data |
| Existing Handle — default import | Skips existing products (no update) |
| Variant matching | Matched by Option values (Option1 Value + Option2 Value + Option3 Value) |
| Images | Replaced entirely on import (existing images removed) |

### 5.14 Source Documentation

| Source | URL | Status |
|--------|-----|--------|
| Shopify CSV Import Guide | https://help.shopify.com/en/manual/products/import-export | Available |
| Shopify Product API | https://shopify.dev/docs/api/admin-rest/current/resources/product | Available |
| Shopify Product Resource Fields | https://shopify.dev/docs/api/admin-rest/current/resources/product | Available |
| Shopify Metafields | https://shopify.dev/docs/api/admin-rest/current/resources/metafield | Available |
| Shopify Product Taxonomy | https://shopify.dev/docs/apps/selling-strategies/categories | Available |

---

## 6. WooCommerce

### 6.1 Platform Overview

WooCommerce is an open-source e-commerce plugin for WordPress. Unlike hosted platforms, WooCommerce stores are self-hosted, giving merchants full control over their product schema via custom fields and plugins. Products are managed through the WordPress admin, WooCommerce REST API, or CSV import/export.

**Key terminology:**
- **Product Types:** Simple, Variable, Grouped, External/Affiliate
- **Simple Product** — Single product without variations
- **Variable Product** — Product with variations (parent/child via attributes)
- **Grouped Product** — Collection of related simple products
- **External/Affiliate Product** — Product sold on another site (link out)
- **Attribute** — Product characteristic used for filtering or generating variations
- **Variation** — A specific variant of a variable product (defined by attribute values)
- **Category** — Hierarchical product classification
- **Tag** — Flat taxonomy label for products
- **SKU** — Stock Keeping Unit (unique per product/variation)

### 6.2 Product Types

| Type | Description | Purchasable | Has Variations |
|------|-------------|:-----------:|:--------------:|
| Simple | Standard single product | ✅ | ❌ |
| Variable | Product with variant options | ❌ (parent) | ✅ |
| Grouped | Collection of simple products | ❌ (container) | ❌ |
| External/Affiliate | Link to external product | ❌ (redirect) | ❌ |

### 6.3 Common Product Fields

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| Type | Enum | OPTIONAL | Type | simple, variable, grouped, external (defaults to simple) |
| SKU | String | REQUIRED | SKU | Unique stock keeping unit |
| Name | String | REQUIRED | Name | Product title/name |
| Published | Integer/Boolean | OPTIONAL | Published | 1 = published, 0 = draft, -1 = pending |
| Is featured? | Boolean | OPTIONAL | Is featured? | 1 or 0 |
| Visibility in catalog | Enum | OPTIONAL | Visibility in catalog | visible, catalog, search, hidden |
| Short description | HTML | OPTIONAL | Short description | Brief product summary |
| Description | HTML | OPTIONAL | Description | Full product description |
| Sale price | Decimal | OPTIONAL | Sale price | Promotional price |
| Regular price | Decimal | REQUIRED (simple) | Regular price | Standard product price |
| Categories | Hierarchical string | OPTIONAL | Categories | e.g., "Clothing > Mens > Shirts" |
| Tags | Comma-separated | OPTIONAL | Tags | Product tags |
| Images | URLs (comma-separated) | OPTIONAL | Images | Product image URLs |
| Parent | SKU/ID | CONDITIONAL | Parent | Parent SKU for variations |
| Position | Integer | OPTIONAL | Position | Menu/display order |

### 6.4 Inventory/Stock Fields

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| In stock? | Boolean | OPTIONAL | In stock? | 1 = in stock, 0 = out of stock |
| Stock | Integer | OPTIONAL | Stock | Stock quantity (if managed) |
| Low stock amount | Integer | OPTIONAL | Low stock amount | Threshold for low stock notification |
| Backorders allowed? | Enum | OPTIONAL | Backorders allowed? | 0 = no, 1 = allow, notify = allow & notify |
| Sold individually? | Boolean | OPTIONAL | Sold individually? | 1 = limit to 1 per order |
| Manage stock? | Boolean | OPTIONAL | Manage stock? | 1 = enable stock management |

### 6.5 Shipping/Dimensions Fields

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| Weight | Decimal | OPTIONAL | Weight (kg) | Product weight |
| Length | Decimal | OPTIONAL | Length (cm) | Package length |
| Width | Decimal | OPTIONAL | Width (cm) | Package width |
| Height | Decimal | OPTIONAL | Height (cm) | Package height |
| Shipping class | String | OPTIONAL | Shipping class | Shipping class slug |

### 6.6 Variation/Attribute Fields

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| Attribute 1 name | String | CONDITIONAL | Attribute 1 name | First attribute name (e.g., "Color") |
| Attribute 1 value(s) | Pipe-separated | CONDITIONAL | Attribute 1 value(s) | Values separated by pipe: "Red\|Blue\|Green" |
| Attribute 1 visible | Boolean | OPTIONAL | Attribute 1 visible | Show on product page |
| Attribute 1 global | Boolean | OPTIONAL | Attribute 1 global | Use global attribute (vs product-level) |
| Attribute 2 name | String | OPTIONAL | Attribute 2 name | Second attribute name |
| Attribute 2 value(s) | Pipe-separated | OPTIONAL | Attribute 2 value(s) | Second attribute values |

- WooCommerce supports **unlimited attributes** (not limited to 3 like Shopify)
- Attributes marked for variations generate the variation matrix
- Global attributes are store-wide; local attributes are product-specific

### 6.7 Variable Product / Variation Rows

For variable products in CSV:
- **Parent row:** Type = "variable", defines attributes with all possible values
- **Variation rows:** Type = "variation", Parent = parent SKU, each attribute has a single value

| Field | Parent Row | Variation Row |
|-------|-----------|---------------|
| Type | variable | variation |
| SKU | Parent SKU | Variation SKU |
| Parent | — | Parent SKU |
| Attribute values | All values (pipe-separated) | Single value per attribute |
| Regular price | — (set on variations) | REQUIRED |
| Stock | — (set on variations) | Variation stock |
| Images | Product gallery | Variation-specific image |

### 6.8 Grouped Products

- Parent product: Type = "grouped"
- Child products: Separate simple products
- Grouped product CSV column: "Grouped products" — comma-separated list of child SKUs or IDs
- No pricing on grouped parent (each child has its own price)

### 6.9 External/Affiliate Products

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| External URL | URL | REQUIRED (external) | External URL | Link to external product |
| Button text | String | OPTIONAL | Button text | Custom "Buy" button label |

### 6.10 Downloadable Products

| Field | Type | Required | CSV Column | Description |
|-------|------|----------|------------|-------------|
| Downloadable | Boolean | OPTIONAL | Downloadable | 1 = downloadable product |
| Download 1 name | String | CONDITIONAL | Download 1 name | File display name |
| Download 1 URL | URL | CONDITIONAL | Download 1 URL | File download URL |
| Download limit | Integer | OPTIONAL | Download limit | Max downloads per purchase (-1 = unlimited) |
| Download expiry days | Integer | OPTIONAL | Download expiry days | Days until download link expires (-1 = never) |

### 6.11 Upsells and Cross-sells

| Field | Type | CSV Column | Description |
|-------|------|------------|-------------|
| Upsells | Comma-separated IDs/SKUs | Upsells | Products shown as upgrades |
| Cross-sells | Comma-separated IDs/SKUs | Cross-sells | Products shown in cart as complements |

### 6.12 Tax Fields

| Field | Type | CSV Column | Description |
|-------|------|------------|-------------|
| Tax status | Enum | Tax status | taxable, shipping, none |
| Tax class | String | Tax class | Standard, reduced-rate, zero-rate, or custom class |

### 6.13 Image Requirements

- No strict platform minimum resolution (store-theme dependent)
- Recommended: 800×800 minimum for product images
- Maximum file size: WordPress/server upload limit (typically 2-50 MB depending on hosting)
- Supported formats: JPEG, PNG, GIF, WebP (WordPress 5.8+)
- Multiple images: comma-separated URLs in CSV
- First image in list = featured/primary image
- Subsequent images = product gallery
- Variation images: one image per variation

### 6.14 SEO/Metadata Fields

WooCommerce SEO depends on installed plugins (Yoast SEO, Rank Math, etc.). Core WooCommerce does not have built-in SEO meta fields in the CSV importer.

| Field | Source | Description |
|-------|--------|-------------|
| Product name | Core | Used as page title if no SEO plugin |
| Slug | Core | URL-friendly product identifier |
| Short description | Core | Often used as meta description |
| Meta: _yoast_wpseo_title | Plugin (Yoast) | Custom SEO title |
| Meta: _yoast_wpseo_metadesc | Plugin (Yoast) | Custom meta description |

> **NOTE:** SEO field handling is store-specific depending on installed plugins.

### 6.15 Custom Metadata

| Field | Type | CSV Column Pattern | Description |
|-------|------|-------------------|-------------|
| Meta: {key} | Various | Meta: custom_field_name | Custom post meta fields |

- WooCommerce supports arbitrary custom metadata via "Meta:" prefixed CSV columns
- Store-specific: depends on installed plugins and custom development
- MerchOS adapter must support configurable metadata mapping per store

### 6.16 Identifier Requirements

| Identifier | Format | Notes |
|------------|--------|-------|
| SKU | Free-form string | Must be unique across all products/variations in the store |
| Product ID | Integer (WordPress-assigned) | Auto-increment; not submitted |
| Barcode | Not native to WooCommerce | Requires plugin or custom meta field |
| Slug | URL-safe string | Auto-generated from name; unique per store |

### 6.17 Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| SKU unique per store | ERROR | No duplicate SKUs across products and variations |
| Name present | ERROR | Product name/title required |
| Regular price present (simple products) | ERROR | Simple products must have a price |
| Regular price present (variations) | ERROR | Each variation must have a price |
| Type valid | ERROR | Must be: simple, variable, grouped, external |
| Parent SKU exists (for variations) | ERROR | Variation must reference valid parent |
| External URL present (external products) | ERROR | External products require a URL |
| Price ≥ 0 | ERROR | Non-negative pricing |
| Stock ≥ 0 | WARNING | Negative stock unusual but not strictly prevented |
| Categories format valid | WARNING | Hierarchical: "Parent > Child > Grandchild" |
| Image URLs accessible | WARNING | Images should resolve at export time |
| Attribute values match parent (variations) | ERROR | Variation attributes must be subset of parent's defined values |
| Download URLs accessible (downloadable products) | ERROR | Must resolve to valid file |
| Weight/dimensions numeric | ERROR | Must be valid decimal numbers |

### 6.18 Export Format (CSV)

- **Format:** CSV (comma-separated values)
- **Encoding:** UTF-8 (BOM optional)
- **Header row:** Required; standard WooCommerce column names
- **Hierarchy representation:** Categories use " > " separator; attributes use "\|" (pipe) separator for multiple values
- **Boolean values:** 1 / 0 (integer representation)
- **Multi-value fields:** Comma-separated (images, tags, upsells, cross-sells)
- **Empty fields:** Leave blank
- **Variable products:** Parent row followed by variation rows (Type = "variation")
- **Images:** Comma-separated URLs; first = featured image

### 6.19 Import/Update Behaviour

| Scenario | Behaviour |
|----------|-----------|
| New product (new SKU) | Creates product with all provided data |
| Existing SKU — Update existing | Updates matched fields; preserves unmentioned fields |
| Existing SKU — Skip | Skips the row (no changes) |
| ID matching | Can match by product ID instead of SKU |
| Variations | Matched by parent SKU + attribute combination |
| Images on update | Replaced (existing images removed, new set applied) |

### 6.20 Error Handling

WooCommerce CSV importer provides per-row feedback:
- **Imported:** Successfully created/updated
- **Updated:** Existing product modified
- **Skipped:** Row skipped (usually duplicate with skip mode)
- **Failed:** Row could not be processed (with error message)

Common errors:
- Invalid product type
- Missing required price
- Parent product not found (for variations)
- Invalid SKU (duplicate)
- File encoding issues
- Malformed CSV structure

### 6.21 Source Documentation

| Source | URL | Status |
|--------|-----|--------|
| WooCommerce CSV Import Documentation | https://woocommerce.com/document/product-csv-importer-exporter/ | Available |
| WooCommerce REST API — Products | https://woocommerce.github.io/woocommerce-rest-api-docs/#products | Available |
| WooCommerce Product Types | https://woocommerce.com/document/managing-products/ | Available |
| WooCommerce Product CSV Schema | Core plugin source: includes/import/ | Available |

---

## 7. Cross-Platform Comparison

### 7.1 Field Coverage Matrix

| Concept | Takealot | Makro | Amazon | Shopify | WooCommerce |
|---------|----------|-------|--------|---------|-------------|
| Product title | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required |
| Description | ✅ Required | ✅ Required | ✅ Required | Optional | Optional |
| Brand | ✅ Required | ✅ Required | ✅ Required | Optional (Vendor) | Optional |
| SKU | ✅ Required | ✅ Required | ✅ Required | Optional | ✅ Required |
| Barcode (EAN/UPC) | ✅ Required | ✅ Required | ✅ Required* | Optional | Not native |
| Price | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required |
| Stock quantity | ✅ Required | ✅ Required | ✅ Required | Optional | Optional |
| Images | ✅ Required (1+) | ✅ Required (1+) | ✅ Required (1+) | Optional | Optional |
| Weight | Conditional | ✅ Required | Conditional | Optional | Optional |
| Dimensions | Conditional | ✅ Required | Conditional | — | Optional |
| Category | ✅ Required | ✅ Required (Vertical) | ✅ Required (Product Type) | Optional | Optional |
| Variants | Supported | REQUIRES VERIFICATION | ✅ Supported | ✅ Supported (max 100) | ✅ Supported |
| SEO fields | — | — | — | Optional | Plugin-dependent |
| Custom attributes | Limited | Vertical-specific | Category-specific | Metafields | Custom meta |

*Amazon: GTIN exemption available per category

### 7.2 Export Format Comparison

| Platform | Primary Format | Encoding | Delimiter | Header |
|----------|---------------|----------|-----------|--------|
| Takealot | CSV / XLSX | UTF-8 | Comma / XLSX | Required |
| Makro | CSV (loadsheet) | UTF-8 | Comma | Required |
| Amazon | TSV (flat file) | UTF-8 | Tab | Required (with metadata rows) |
| Shopify | CSV | UTF-8 | Comma | Required |
| WooCommerce | CSV | UTF-8 | Comma | Required |

### 7.3 Category/Vertical Complexity

| Platform | Category Awareness | Impact on Schema |
|----------|-------------------|------------------|
| Takealot | Moderate | Some category-specific fields |
| Makro | HIGH | Entire loadsheet changes per vertical |
| Amazon | HIGH | Product type determines all required attributes |
| Shopify | Low | Product Category is optional; no schema impact |
| WooCommerce | Low | Categories are organizational; no schema impact |

### 7.4 Variant Model Comparison

| Platform | Max Variants | Max Options/Axes | Model |
|----------|:------------:|:----------------:|-------|
| Takealot | REQUIRES VERIFICATION | Limited | TSIN-based parent/child |
| Makro | REQUIRES VERIFICATION | Vertical-dependent | Loadsheet rows |
| Amazon | Unlimited (practical limit ~2000) | Theme-dependent | Parent/child SKUs |
| Shopify | 100 | 3 | Product options + variant matrix |
| WooCommerce | Unlimited (practical limit ~50-100) | Unlimited | Attributes + variation posts |

---

## 8. Verification Log

This section tracks when each platform's requirements were last verified against actual platform documentation or templates.

| Platform | Section | Last Verified | Verified By | Status | Notes |
|----------|---------|:-------------:|-------------|--------|-------|
| Takealot | Bulk Offers fields (2.3) | 2025-01 | Template obtained | Verified | From actual Bulk Offers download |
| Takealot | Product Creation (2.4) | — | — | Draft | REQUIRES VERIFICATION against current template |
| Makro | Common fields (3.4) | 2025-01 | Templates obtained | Verified | From actual loadsheet downloads |
| Makro | Category-specific (3.5) | 2025-01 | Templates obtained | Partial | Some verticals verified, others pending |
| Amazon | Common fields (4.4) | — | — | Draft | Based on public documentation |
| Amazon | Category-specific (4.5) | — | — | Draft | REQUIRES actual Seller Central templates |
| Shopify | Product fields (5.2) | 2025-01 | Public docs | Verified | From official Shopify documentation |
| Shopify | CSV format (5.12) | 2025-01 | Public docs | Verified | From official CSV import guide |
| WooCommerce | Product fields (6.3) | 2025-01 | Public docs | Verified | From official WooCommerce documentation |
| WooCommerce | CSV format (6.18) | 2025-01 | Public docs | Verified | From WooCommerce core source |

---

> **Maintenance Note:** This document must be updated whenever marketplace platforms change their templates, field requirements, or validation rules. Each update must include the verification date and source in the Verification Log above.
