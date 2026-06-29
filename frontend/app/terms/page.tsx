import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos de Servicio · MATA AI",
  description: "Términos y condiciones de uso de la plataforma MATA AI.",
};

const UPDATED = "29 de junio de 2026";

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-white mb-2">Términos de Servicio</h1>
      <p className="text-sm text-white/40 mb-10">Última actualización: {UPDATED}</p>

      <Section title="1. Aceptación de los términos">
        Al crear una cuenta o usar MATA AI (el “Servicio”) aceptas estos Términos de
        Servicio. Si no estás de acuerdo, no uses el Servicio. Si usas MATA AI en nombre
        de una organización, declaras tener autoridad para vincularla a estos términos.
      </Section>

      <Section title="2. Descripción del Servicio">
        MATA AI es una plataforma de inteligencia artificial que ofrece chat, generación
        de imágenes, video, música, código, agentes y herramientas relacionadas. El
        Servicio se apoya en proveedores de modelos de terceros y puede cambiar, añadir o
        retirar funciones en cualquier momento.
      </Section>

      <Section title="3. Cuentas y seguridad">
        Eres responsable de mantener la confidencialidad de tus credenciales y de toda la
        actividad realizada bajo tu cuenta. Debes proporcionar información veraz y
        notificarnos de inmediato cualquier uso no autorizado. Debes tener al menos 18
        años, o la mayoría de edad en tu jurisdicción.
      </Section>

      <Section title="4. Uso aceptable">
        <p>No puedes usar el Servicio para:</p>
        <ul>
          <li>generar contenido ilegal, abusivo, difamatorio o que infrinja derechos de terceros;</li>
          <li>crear material sexual con menores, violencia gráfica o contenido de odio;</li>
          <li>suplantar identidades, engañar o crear desinformación dañina;</li>
          <li>vulnerar, sobrecargar o intentar eludir las medidas de seguridad o límites de uso;</li>
          <li>revender o redistribuir el Servicio sin autorización escrita.</li>
        </ul>
        Podemos suspender o cerrar cuentas que incumplan estas reglas.
      </Section>

      <Section title="5. Contenido generado y propiedad">
        Conservas los derechos sobre el contenido que generas, en la medida permitida por
        la ley y por los términos de los proveedores de modelos subyacentes. Eres
        responsable del contenido que creas y de cómo lo usas. El contenido generado por IA
        puede ser inexacto; verifícalo antes de tomar decisiones importantes.
      </Section>

      <Section title="6. Créditos, planes y pagos">
        El Servicio funciona con un sistema de créditos y planes de suscripción. Los pagos
        se procesan a través de proveedores externos (por ejemplo, PayPal). Las
        suscripciones se renuevan automáticamente hasta que las canceles. Salvo que la ley
        exija lo contrario, los créditos consumidos y los pagos no son reembolsables.
      </Section>

      <Section title="7. Disponibilidad y cambios">
        El Servicio se ofrece “tal cual” y “según disponibilidad”. Podemos modificar,
        suspender o discontinuar el Servicio, total o parcialmente, con o sin aviso.
      </Section>

      <Section title="8. Limitación de responsabilidad">
        En la máxima medida permitida por la ley, MATA AI no será responsable de daños
        indirectos, incidentales o consecuentes, ni de pérdida de datos, ingresos o
        beneficios derivados del uso del Servicio. Nuestra responsabilidad total se limita
        al importe que hayas pagado en los 12 meses anteriores al hecho que originó la
        reclamación.
      </Section>

      <Section title="9. Modificaciones de los términos">
        Podemos actualizar estos términos. Si los cambios son sustanciales, te lo
        notificaremos. El uso continuado del Servicio tras la entrada en vigor implica tu
        aceptación.
      </Section>

      <Section title="10. Contacto">
        Para cualquier consulta sobre estos términos, escríbenos a{" "}
        <a href="mailto:lacurard31@gmail.com">lacurard31@gmail.com</a>.
      </Section>

      <p className="text-sm text-white/40 mt-12">
        Consulta también nuestra{" "}
        <Link href="/privacy" className="text-white/70 underline hover:text-white">
          Política de Privacidad
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
      <div className="text-sm leading-relaxed text-white/60 space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:text-white/80 [&_a]:underline">
        {children}
      </div>
    </section>
  );
}
