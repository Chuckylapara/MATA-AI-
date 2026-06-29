import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidad · MATA AI",
  description: "Cómo MATA AI recopila, usa y protege tus datos personales.",
};

const UPDATED = "29 de junio de 2026";

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-white mb-2">Política de Privacidad</h1>
      <p className="text-sm text-white/40 mb-10">Última actualización: {UPDATED}</p>

      <Section title="1. Qué datos recopilamos">
        <ul>
          <li><strong>Datos de cuenta:</strong> nombre, correo electrónico y contraseña (almacenada cifrada).</li>
          <li><strong>Contenido de uso:</strong> los mensajes, prompts y archivos que envías para generar resultados.</li>
          <li><strong>Datos de pago:</strong> gestionados por nuestros proveedores de pago; no almacenamos los números completos de tu tarjeta.</li>
          <li><strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo y registros de uso para seguridad y diagnóstico.</li>
        </ul>
      </Section>

      <Section title="2. Cómo usamos tus datos">
        <ul>
          <li>Proveer y operar el Servicio y sus funciones de IA.</li>
          <li>Procesar pagos, créditos y suscripciones.</li>
          <li>Prevenir abusos, fraude y garantizar la seguridad.</li>
          <li>Mejorar el Servicio y comunicarnos contigo sobre tu cuenta.</li>
        </ul>
        No vendemos tus datos personales.
      </Section>

      <Section title="3. Proveedores de IA y terceros">
        Para generar resultados, tu contenido puede enviarse a proveedores de modelos de
        terceros (por ejemplo, NVIDIA, Anthropic o Google). También usamos proveedores de
        infraestructura y pago (por ejemplo, Render, PayPal). Estos terceros procesan datos
        según sus propias políticas y solo en la medida necesaria para prestar el Servicio.
      </Section>

      <Section title="4. Conservación de datos">
        Conservamos tus datos mientras tu cuenta esté activa y durante el tiempo necesario
        para cumplir obligaciones legales, resolver disputas y hacer cumplir nuestros
        acuerdos. Puedes solicitar la eliminación de tu cuenta en cualquier momento.
      </Section>

      <Section title="5. Tus derechos">
        Según tu jurisdicción (por ejemplo, bajo el RGPD en la UE o leyes similares),
        puedes tener derecho a acceder, rectificar, eliminar o exportar tus datos, así como
        a oponerte a ciertos tratamientos. Para ejercerlos, escríbenos al contacto de abajo.
      </Section>

      <Section title="6. Seguridad">
        Aplicamos medidas técnicas y organizativas razonables para proteger tus datos
        (contraseñas cifradas, conexiones seguras y control de acceso). Ningún sistema es
        100% seguro, pero trabajamos para protegerlos.
      </Section>

      <Section title="7. Menores de edad">
        El Servicio no está dirigido a menores de 18 años y no recopilamos
        intencionadamente datos de menores. Si crees que un menor nos ha proporcionado
        datos, contáctanos para eliminarlos.
      </Section>

      <Section title="8. Cookies">
        Usamos almacenamiento local y cookies estrictamente necesarias para mantener tu
        sesión iniciada y el funcionamiento del Servicio.
      </Section>

      <Section title="9. Cambios en esta política">
        Podemos actualizar esta política. Publicaremos la versión vigente en esta página y,
        si los cambios son sustanciales, te lo notificaremos.
      </Section>

      <Section title="10. Contacto">
        Para preguntas sobre privacidad o para ejercer tus derechos, escríbenos a{" "}
        <a href="mailto:lacurard31@gmail.com">lacurard31@gmail.com</a>.
      </Section>

      <p className="text-sm text-white/40 mt-12">
        Consulta también nuestros{" "}
        <Link href="/terms" className="text-white/70 underline hover:text-white">
          Términos de Servicio
        </Link>
        .
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium text-white/90 mb-2">{title}</h2>
      <div className="text-sm leading-relaxed text-white/60 space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-white/80 [&_a]:underline [&_strong]:text-white/80">
        {children}
      </div>
    </section>
  );
}
