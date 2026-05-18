/**
 * SmallScreenNotice — hint shown on pages whose primary use case is editing.
 *
 * Rendered above the page body and visible only on screens below `sm` (640px).
 * The form itself is still rendered below — the notice is advisory, not a
 * block. Users on narrow screens can still tap through if they really need
 * to, but the layout is honest about its target size.
 */

export default function SmallScreenNotice() {
  return (
    <div className="sm:hidden mb-3 px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-900 text-xs">
      <strong>Tight fit.</strong> This page is designed for editing on a
      wider screen. Status and read-only views (Mission Control · Beads ·
      Doctor) work great here; complex forms are easier with more room.
    </div>
  );
}
