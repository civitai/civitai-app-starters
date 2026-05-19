export function LoginButton() {
  return (
    <form method="post" action="/api/auth/login">
      <button
        type="submit"
        className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-blue-500"
      >
        Sign in with Civitai
      </button>
    </form>
  );
}
