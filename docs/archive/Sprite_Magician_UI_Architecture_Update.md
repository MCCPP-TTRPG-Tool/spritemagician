# Sprite Magician UI Architecture -- Structural Update Spec

## Unified 2D / 3D Creative OS Layout

------------------------------------------------------------------------

# Objective

This document defines the structural UI decisions for Sprite Magician as
it evolves into a unified 2D + 3D creative production system.

The goal is to:

-   Preserve clarity
-   Keep creative workspace dominant
-   Maintain production-level organization
-   Support future scalability (rigging, animation, asset store, etc.)

------------------------------------------------------------------------

# Top Navigation Structure

Primary Navigation:

Home \| 2D \| 3D \| Store \| Account

## Purpose of Each Section

### Home

Project navigation hub. - Recent Projects - Create New 2D Project -
Create New 3D Project - Job Status Overview - Quick Links to Docs

### 2D

Full 2D sprite + animation workspace.

### 3D

Full 3D generation + rig + animation workspace.

### Store

Dedicated asset marketplace. - Featured Packs - Categories - Purchased
Assets - Downloaded Assets - Your Packs (future)

### Account

-   Subscription status
-   Token usage
-   Billing
-   Settings

------------------------------------------------------------------------

# Workspace Layout (2D + 3D Modes)

Layout Structure (Non-Collapsible):

Left Panel \| Center Workspace \| Right File Tree

## Left Panel -- Tools

Contains: - Generation controls - Animation controls - Rigging tools
(future) - Keyframe editor (when active) - Style presets - Topology/UV
controls (3D)

This panel controls "How" the asset is modified.

------------------------------------------------------------------------

## Center -- Workspace (Primary Focus)

2D Mode: - Sprite preview - Animation playback - Timeline - Frame
preview - Export preview

3D Mode: - 3D viewport (Three.js / WebGL) - Orbit controls - Lighting
preview - Animation preview - Sprite render preview (future)

The center is always the creative engine.

------------------------------------------------------------------------

## Right Panel -- File Tree (Persistent)

The file tree remains unchanged across 2D and 3D modes.

Purpose: - Display source files - Display generated files - Display job
outputs - Display exports - Display animation assets

The file tree is never collapsible.

------------------------------------------------------------------------

# File Tree View Modes

Two toggle modes:

## 1. Large Icon View

-   Visual thumbnails
-   Best for creative browsing
-   Ideal for animation frames and sprite sheets

## 2. List View

-   Small icons / emoji indicators
-   File name
-   File type
-   File size
-   Poly count (3D)
-   Frame count (2D)
-   Modified date
-   Optimized status
-   Sortable columns

This supports production workflows and large projects.

------------------------------------------------------------------------

# Tab Refinement

Replace "Frames" tab with a broader concept:

Recommended replacement: "Outputs"

Outputs includes:

2D Mode: - Frames - Sprite sheets - JSON animation data

3D Mode: - LOD variants - Rigged versions - Animated exports - Baked
textures - Rendered sprites

This future-proofs the UI.

------------------------------------------------------------------------

# Home Page Layout

Left Column: - Documentation - Tutorials - API reference - Changelog

Center (Primary): - Recent Projects - Resume Last Project - Create 2D
Project - Create 3D Project - Recent Job Status

Right Column: - Account Summary - Subscription Status - Token Usage -
Featured Packs - Store Access

Home is operational, not commercial-first.

------------------------------------------------------------------------

# Design Philosophy

1.  Workspace always dominates visually.
2.  File system remains stable across modes.
3.  Tools are deterministic and structured.
4.  Commerce is separate from creation.
5.  Human-curated asset philosophy is preserved.
6.  Layout must scale to advanced rigging + animation tools.

------------------------------------------------------------------------

# Long-Term Scalability

This layout supports:

-   Smart Topology integration
-   UV automation
-   Rig editing
-   Keyframe editing
-   Sprite batch rendering
-   Asset pack packaging
-   Community marketplace (future)
-   Preset library system
-   Version history

Without structural redesign.

------------------------------------------------------------------------

# Guiding UX Principle

The center is the creative engine. The left is control. The right is
organization. The top is navigation.

Everything should reinforce that hierarchy.

------------------------------------------------------------------------

END OF DOCUMENT
