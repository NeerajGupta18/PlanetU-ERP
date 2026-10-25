import { useAuth } from '../context/AuthContext.jsx';
import { useFetch } from './useFetch.js';

/**
 * Page titles on the pages a student and a parent share: "My fees" for the student, "Aarav's fees" for the parent.
 *   const whose = useWhose();  whose('fees') -> "My fees" | "Aarav's fees" | "Your child's fees" (before the name loads)
 */
export function useWhose() {
  const { user } = useAuth();
  const kids = useFetch(user?.role === 'parent' ? '/parent/children' : null);
  if (user?.role !== 'parent') return (what) => `My ${what}`;
  const child = kids.data?.children.find((k) => k.id === kids.data.selected) || kids.data?.children[0];
  const first = child?.name?.split(' ')[0];
  return (what) => (first ? `${first}'s ${what}` : `Your child's ${what}`);
}
