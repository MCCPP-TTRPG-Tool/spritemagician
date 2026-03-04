# Sprite Magician Store UI Architecture

## 3-Panel OS-Consistent Marketplace Design

------------------------------------------------------------------------

# Objective

Define the Store page structure while preserving the core 3-panel
architecture:

Left \| Center \| Right

The Store must feel like part of the creative OS --- not a scrolling
marketing website.

No full-page scroll. No layout shifts. No hero banners. No SaaS landing
vibes.

------------------------------------------------------------------------

# Store Page Layout

## Left Panel -- Browse & Search

Purpose: Discovery and filtering.

Contents:

-   Search bar (top)
-   Categories
    -   2D Packs
    -   3D Packs
    -   RTS Units
    -   Environments
    -   Props
    -   Animations
-   Filters
    -   Price range
    -   Poly count range
    -   Rigged / Static
    -   LOD included
    -   Engine format
-   Sort options
    -   Newest
    -   Popular
    -   Price
    -   Asset count

Notes: - Internal panel scroll only (if needed) - Never scroll entire
page - Structured and clean

------------------------------------------------------------------------

## Center Panel -- Pack Grid & Preview

Default State: Grid of asset packs.

Each pack card includes:

-   Thumbnail
-   Pack name
-   Asset count
-   Type (2D / 3D / Mixed)
-   Price
-   Badges (LOD, Rigged, Sprite Included, etc.)

------------------------------------------------------------------------

### Pack Detail View (Center Panel Swap)

When a pack is selected:

Center panel switches to preview mode.

Includes:

-   Image carousel
-   Short description (tight, no essays)
-   Included asset list
-   Technical breakdown:
    -   Poly range
    -   Texture resolution
    -   Formats included
    -   LOD levels
    -   Animation included
    -   Sprite exports included

No page transitions. No new route required. Only center content swaps.

------------------------------------------------------------------------

## Right Panel -- Cart & Checkout

Persistent transaction panel.

Contents:

Top: - Cart summary - Items list - Subtotal

Middle: - Selected pack summary

Bottom: - Checkout button

------------------------------------------------------------------------

### Unauthenticated State

-   Message: "Sign up to purchase"
-   Plans preview
-   Credits explanation

------------------------------------------------------------------------

### Authenticated State

-   Credit balance visible
-   Payment method display
-   Confirm purchase button
-   Apply credits option (if supported)

Checkout completes inside right panel.

No page redirect.

------------------------------------------------------------------------

# Interaction Flow

1.  User browses packs (left + center).
2.  User clicks pack → center shows preview.
3.  User clicks Add to Cart.
4.  Right panel updates immediately.
5.  User completes checkout in right panel.
6.  Pack is:
    -   Added to user library
    -   Optionally auto-imported to file tree

------------------------------------------------------------------------

# Store Design Principles

1.  Maintain 3-panel structure at all times.
2.  Never convert store into scrolling webpage.
3.  No infinite scroll grids.
4.  Use pagination if necessary.
5.  Keep commerce functional, not aggressive.
6.  Preserve OS-level consistency.

------------------------------------------------------------------------

# Future Expansion

Store can later support:

-   Preset packs
-   Rig templates
-   Animation packs
-   Texture style packs
-   User-generated packs
-   Auto-import to file tree
-   Versioned pack updates

All without changing layout.

------------------------------------------------------------------------

# Guiding Rule

Left = Discovery\
Center = Evaluation\
Right = Transaction

The Store is an extension of the production system --- not a detached
marketplace.

------------------------------------------------------------------------

END OF DOCUMENT
