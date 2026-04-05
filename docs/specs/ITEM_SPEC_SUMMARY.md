# QuickBooks Online Item API - OpenAPI 3.0.3 Specification

## Overview
A complete OpenAPI 3.0.3 specification for the QuickBooks Online Item entity with full CRUD operations and comprehensive error handling.

## File Location
`/sessions/zen-admiring-mendel/mnt/Kuso Oishii/Lovable-kusooishii/docs/specs/quickbooks_item_api_full.yaml`

## Specification Coverage

### Endpoints (4 total)
- **POST** `/v3/company/{realmId}/item` - Create or update an item
- **GET** `/v3/company/{realmId}/item/{itemId}` - Read an item by ID
- **GET** `/v3/company/{realmId}/query` - Query items via GET parameter
- **POST** `/v3/company/{realmId}/query` - Query items via POST body

### Item Types (Enum)
Supported item types with 6 values:
- Inventory
- NonInventory
- Service
- Group
- Category
- Bundle

### Item Properties (32 total)

#### Read-Only Fields
- Id
- Level
- FullyQualifiedName
- domain

#### Core Fields (Required for Create)
- Name (string, max 100 chars) - Required
- Type (enum) - Required
- IncomeAccountRef (ReferenceType) - Required

#### Update Required Fields
- Id - Required
- SyncToken (string) - Required

#### Standard Fields
- Sku (string, max 100)
- Description (string, max 4000)
- PurchaseDesc (string, max 4000)
- Active (boolean, default: true)
- SubItem (boolean)
- ParentRef (ReferenceType)
- Taxable (boolean)
- SalesTaxIncluded (boolean)
- PurchaseTaxIncluded (boolean)
- TrackQtyOnHand (boolean)
- UnitPrice (number)
- PurchaseCost (number)
- sparse (boolean)

#### Inventory Management
- QtyOnHand (number) - For Inventory type items
- InvStartDate (date) - For Inventory type items
- AssetAccountRef (ReferenceType) - For Inventory type items
- ReorderPoint (number)

#### Account References
- IncomeAccountRef (ReferenceType)
- ExpenseAccountRef (ReferenceType)
- AssetAccountRef (ReferenceType)

#### Tax & Classification
- SalesTaxCodeRef (ReferenceType)
- PurchaseTaxCodeRef (ReferenceType)
- TaxClassificationRef (ReferenceType)
- ItemCategoryType (enum: Product, Service)

#### India-Specific Fields
- AbatementRate (number)
- ReverseChargeRate (number)
- ServiceType (string)
- Hsnsac (string, HSN/SAC code)

#### Categorization
- ClassRef (ReferenceType)

#### Metadata
- MetaData (object with CreateTime, LastUpdatedTime)

## Response Envelopes
All responses follow the standard QuickBooks envelope format:
- **ItemEnvelope** - Single item response with timestamp
- **ItemQueryEnvelope** - Query results with pagination info
- **FaultEnvelope** - Error responses with detailed fault information

## Error Handling
Comprehensive fault handling with specific HTTP status codes:
- 400 Bad Request
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found
- 429 Rate Limit Exceeded
- Default/5xx Server Error

Each fault includes:
- Error message and detail
- Error code
- Element that caused the error

## Security
OAuth 2.0 (intuitOAuth2) with authorization code flow:
- Authorization URL: `https://appcenter.intuit.com/connect/oauth2`
- Token URL: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- Scope: `com.intuit.quickbooks.accounting`

## Servers
- Production: `https://quickbooks.api.intuit.com`
- Sandbox: `https://sandbox-quickbooks.api.intuit.com`

## Specification Format
- **OpenAPI Version**: 3.0.3
- **Format**: YAML
- **Total Lines**: 589
- **Validation Status**: Valid YAML syntax

## Schema Composition
Uses composition patterns matching the Account spec:
- `ItemWrite` - Base schema for write operations
- `ItemCreateRequest` - Extends ItemWrite with create-specific requirements
- `ItemUpdateRequest` - Extends ItemWrite with update-specific requirements
- `Item` - Complete read schema with read-only fields

## Features
- Full CRUD support (Create, Read, Update, Query)
- GET and POST query support
- Comprehensive field descriptions and examples
- Type definitions and enums
- Required field specifications
- Read-only field documentation
- Max length constraints
- Date and datetime formats
- Number precision specification
