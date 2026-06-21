export const materialCatalog = [
  {
    category: "lumber",
    query: "select pine board 1x12",
    notes: "Common shelf and tabletop stock for beginner builds."
  },
  {
    category: "lumber",
    query: "select pine board 1x3",
    notes: "Useful for rails, aprons, and light framing."
  },
  {
    category: "panel",
    query: "3/4 inch plywood project panel",
    notes: "Stable alternative when wide solid boards are expensive."
  },
  {
    category: "fastener",
    query: "wood screws 1-1/4 inch",
    notes: "General assembly fastener for plywood or dimensional lumber."
  },
  {
    category: "fastener",
    query: "pocket hole screws",
    notes: "Works well with pocket-hole joinery for beginner furniture."
  },
  {
    category: "adhesive",
    query: "interior wood glue",
    notes: "Improves joint strength when paired with mechanical fasteners."
  },
  {
    category: "finish",
    query: "water based polyurethane satin",
    notes: "Durable clear coat for tabletops and shelves."
  },
  {
    category: "finish",
    query: "wood stain sample",
    notes: "Low-cost way to approximate the inspiration image tone."
  },
  {
    category: "hardware",
    query: "furniture leveling feet",
    notes: "Helpful for tables on uneven floors."
  },
  {
    category: "finish",
    query: "multi surface primer quart",
    notes: "Required before painting MDF, plywood edges, or bare wood to match a factory colour."
  },
  {
    category: "finish",
    query: "red semi gloss interior latex paint quart",
    notes: "For colour-matching a painted pedestal base; verify with a sample pot first."
  },
  {
    category: "hardware",
    query: "3 inch steel pipe",
    notes: "Structural core for a pedestal column; can be powder-coated instead of painted."
  },
  {
    category: "hardware",
    query: "adjustable leveling foot 1/4-20",
    notes: "Level a cross-base pedestal on uneven floors."
  },
  {
    category: "tool",
    query: "clamp set woodworking",
    notes: "Keeps panels square during assembly."
  }
];

export function buildStoreLinks(materials, zipcode) {
  const normalizedZip = String(zipcode || "").trim();

  return materials.map((material) => {
    const query = material.store_query || material.name;
    return {
      material: material.name,
      query,
      home_depot: `https://www.homedepot.com/s/${encodeURIComponent(query)}`,
      lowes: `https://www.lowes.com/search?searchTerm=${encodeURIComponent(query)}`,
      local_hardware_search: normalizedZip
        ? `https://www.google.com/maps/search/${encodeURIComponent(`${query} hardware store near ${normalizedZip}`)}`
        : `https://www.google.com/maps/search/${encodeURIComponent(`${query} hardware store near me`)}`
    };
  });
}

export function catalogContext() {
  return materialCatalog
    .map((item) => `- ${item.category}: ${item.query}. ${item.notes}`)
    .join("\n");
}
