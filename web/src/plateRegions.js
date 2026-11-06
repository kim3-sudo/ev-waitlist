// Groups the plate regions the server offers, keeping the server's order, for a
// select with one heading per group.
export function groupedRegions(regions) {
  const groups = [];
  for (const region of regions ?? []) {
    let group = groups.find((g) => g.name === region.group);
    if (!group) {
      group = { name: region.group, items: [] };
      groups.push(group);
    }
    group.items.push(region);
  }
  return groups;
}
