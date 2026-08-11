// Shared node/edge model for the backend control-plane graph. Deliberately generic so the
// assembler can source it from JSON today and from relational tables after the P2 cutover —
// the graph shape does not change, only where the loaders read from.

export type CpNodeKind =
  | "template"
  | "checklist"
  | "catalogItem"
  | "indicator"
  | "journeyOutcome"
  | "domain" // programme domain (Creche, ChildrenCentre…) — the organizing hub
  | "facilityLayer"; // facility layer type (creches, children_centres…) — the bridge to the geography canvas

export type CpEdgeKind =
  | "templateChecklist" // template → its checklist item (structural)
  | "catalogRef" // catalog item → the template checklist it tags
  | "indicatorBinding" // checklist item → facility indicator (ActivityIndicatorBinding)
  | "outcomeBinding" // checklist item → programme-journey outcome
  | "templateDomain" // template → its programme domain
  | "indicatorDomain" // indicator → its programme domain
  | "templateLayer" // template → the facility layer it targets (linkedFacilityLayerKey)
  | "indicatorLayer" // indicator → the facility layer it measures (facilityLayerKey)
  | "layerDomain"; // facility layer → its programme domain

export type CpNode = {
  id: string;
  kind: CpNodeKind;
  label: string;
  sublabel?: string | null;
  domain?: string | null;
  href?: string | null; // deep-link to the existing editor for this entity
  broken?: boolean; // e.g. a phantom checklist referenced by a binding but absent from the template
};

export type CpEdge = {
  id: string;
  from: string;
  to: string;
  kind: CpEdgeKind;
  label?: string | null;
  broken?: boolean; // string-join edge whose target key is not in the template's key set
};

export type CpGraph = {
  nodes: CpNode[];
  edges: CpEdge[];
  domains: string[]; // distinct domains present, for the filter
  brokenCount: number;
};
