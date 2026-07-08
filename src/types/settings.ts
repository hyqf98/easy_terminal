export interface ShortcutBinding {
  id: string;
  label: string;
  description: string;
  category?: string;
  editable?: boolean;
  deletable?: boolean;
  windows: string;
  darwin: string;
  linux: string;
}
