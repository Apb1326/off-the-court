import { redirect } from 'next/navigation';

/**
 * The app boots into the Main Menu (save management). The in-game League Office
 * dashboard now lives at `/league`.
 */
export default function RootPage() {
  redirect('/menu');
}
