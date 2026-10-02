export default function HomePage() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '96px 24px',
      }}
    >
      <h1 style={{ fontSize: 48, fontWeight: 700, letterSpacing: '0.04em', margin: 0 }}>KADRO</h1>
      <p style={{ fontSize: 22, fontWeight: 600, color: '#1B7F4B', margin: '12px 0 24px' }}>
        Kadron eksik kalmasın.
      </p>
      <p style={{ fontSize: 17, lineHeight: 1.6, color: '#5B6B62', margin: 0 }}>
        Kadro, halı saha maçlarını organize eden, eksik oyuncuyu mahalleden bulan ve saha ücretini
        takip eden uygulamadır.
      </p>
    </main>
  );
}
