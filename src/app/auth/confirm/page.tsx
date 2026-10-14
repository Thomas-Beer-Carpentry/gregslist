import { ConfirmationForm } from "./confirmation-form";

export default function Confirm() {
  return (
    <main id="main" className="auth">
      <section className="card">
        <p className="eyebrow">Your community, privately</p>
        <h1>A secure welcome.</h1>
        <ConfirmationForm />
      </section>
    </main>
  );
}
