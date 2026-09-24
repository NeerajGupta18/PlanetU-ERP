import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="notfound">
      <h1>404</h1>
      <p>That page does not exist.</p>
      <Link className="btn btn--primary" to="/">Go to home</Link>
    </div>
  );
}
