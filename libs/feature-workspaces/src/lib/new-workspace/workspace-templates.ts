export interface WorkspaceTemplate {
  name: string;
  schematicSet: string;
  schematic?: any;
}

export const WORKSPACE_TEMPLATES: WorkspaceTemplate[] = [
  {
    name: 'Default',
    schematicSet: '@schematics/angular'
  },
  {
    name: 'Proof of concept',
    schematicSet: '@schematics/angular'
  },
  {
    name: 'Angular',
    schematicSet: '@nrwl/workspace'
  },
  {
    name: 'Angular with Ivy',
    schematicSet: '@nrwl/workspace'
  },
  {
    name: 'Empty',
    schematicSet: '@nrwl/workspace'
  }
];
