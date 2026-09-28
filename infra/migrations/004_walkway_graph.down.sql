BEGIN;
ALTER TABLE poi_entrances DROP CONSTRAINT IF EXISTS poi_entrances_graph_node_ref_fk;
DROP TABLE IF EXISTS walk_edges;
DROP TABLE IF EXISTS walk_nodes;
COMMIT;
