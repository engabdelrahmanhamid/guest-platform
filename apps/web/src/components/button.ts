/** Button styling shared by server and client components. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid' | 'ghost' | 'link';

export function buttonClass(variant: ButtonVariant, size?: 'sm', block?: boolean): string {
  return `btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''}`;
}
