import type { components } from '@/api/generated/schema';

export type DomainDocument = components['schemas']['DomainDocument'];
export type CableType = components['schemas']['CableType'];
export type Material = components['schemas']['Material'];
export type Section = components['schemas']['Section'];
export type DrawingState = 'empty' | 'loading' | 'error' | 'success' | 'historical';
export type DrawingCommand = 'undo' | 'redo' | 'save';
export type LayerTarget = { scope: 'core'; coreId: string; role: string } | { scope: 'common'; role: string };
export type SectionSelection = { kind: 'cable' | 'enclosure' | 'backfill' | 'soil'; id: string } | null;

export interface DrawingIssue { field: string; message: string }
export interface DrawingView { x: number; z: number; widthM: number }
export interface PixelSize { width: number; height: number }
export interface WorldPoint { x: number; z: number }
export interface ScreenPoint { x: number; y: number }

export interface CableDimensionEdit {
  target: LayerTarget;
  field: 'diameter' | 'thickness';
  valueM: number;
  previousValueM: number;
}

export interface CableSectionProps {
  cableType: CableType | null;
  materials: readonly Material[];
  selectedObject?: LayerTarget | null;
  onSelectionChange?: (selection: LayerTarget | null) => void;
  onDimensionChange?: (edit: CableDimensionEdit) => void | Promise<void>;
  editable?: boolean;
  isLocked?: (target: LayerTarget) => boolean;
  state?: DrawingState;
  error?: string;
  onRetry?: () => void;
  showDimensions?: boolean;
  onCommand?: (command: DrawingCommand) => void;
  className?: string;
  label?: string;
}

export interface SectionEdit {
  gestureId: string;
  kind: 'move' | 'resize' | 'dimension' | 'soil-boundary' | 'delete' | 'arrange';
  selection: SectionSelection;
  fields: readonly string[];
}

export interface TemplateOption { id: string; label: string; disabled?: boolean }

export interface LayingSectionProps {
  document: DomainDocument | null;
  sectionId: string;
  selectedObject?: SectionSelection;
  onSelectionChange?: (selection: SectionSelection) => void;
  onChange?: (section: Section, edit: SectionEdit) => void | Promise<void>;
  onPreview?: (section: Section | null, edit: SectionEdit) => void;
  onTemplateRequest?: (templateId: string) => void | Promise<void>;
  templates?: readonly TemplateOption[];
  onObjectCommand?: (command: 'duplicate' | 'delete' | 'parallel' | 'trefoil' | 'align', selection: SectionSelection) => void;
  objectCommands?: readonly ('duplicate' | 'delete' | 'parallel' | 'trefoil' | 'align')[];
  onCommand?: (command: DrawingCommand) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  editable?: boolean;
  isLocked?: (field: string) => boolean;
  state?: DrawingState;
  error?: string;
  onRetry?: () => void;
  snapStepM?: number;
  showDimensions?: boolean;
  className?: string;
  label?: string;
}
