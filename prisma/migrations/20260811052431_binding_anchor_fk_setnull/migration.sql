-- Change ActivityIndicatorBinding anchor FKs from CASCADE to SET NULL so deleting a checklist/catalog
-- item orphans (re-pointable) the binding instead of destroying it.
ALTER TABLE "ActivityIndicatorBinding" DROP CONSTRAINT "ActivityIndicatorBinding_checklistDefId_fkey";
ALTER TABLE "ActivityIndicatorBinding" ADD CONSTRAINT "ActivityIndicatorBinding_checklistDefId_fkey" FOREIGN KEY ("checklistDefId") REFERENCES "TemplateChecklistDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityIndicatorBinding" DROP CONSTRAINT "ActivityIndicatorBinding_catalogItemDefId_fkey";
ALTER TABLE "ActivityIndicatorBinding" ADD CONSTRAINT "ActivityIndicatorBinding_catalogItemDefId_fkey" FOREIGN KEY ("catalogItemDefId") REFERENCES "CatalogItemDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
