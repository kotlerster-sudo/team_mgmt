-- Store the (templateSlug, checklistKey) a catalog item materialises on a visit, so bindings created
-- against catalog-native items can set the legacy string keys runtime capture reads.
ALTER TABLE "CatalogItemDef" ADD COLUMN "refTemplateSlug" TEXT, ADD COLUMN "refChecklistKey" TEXT;
