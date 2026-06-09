interface Props {
  onClose: () => void;
}

const examples = [
  '"D=1200, K=4000, H=800. Calculá el EOQ."',
  '"¿Qué es el Costo Total Esperado?"',
  '"Explicame la fórmula del Modelo de Wilson."',
  '"Mostrame el gráfico de costos para D=5000, K=50, H=2."',
  '"Dame un ejercicio para practicar EOQ."',
];

const requiredData = [
  'D → Demanda anual.',
  'K → Costo de realizar un pedido.',
  'H (o c₁) → Costo de almacenamiento por unidad y por período.',
];

const usageModes = [
  'Modo cálculo: resuelve automáticamente ejercicios EOQ a partir de los datos proporcionados.',
  'Modo teoría: explica conceptos, fórmulas, supuestos y aplicaciones del Modelo de Wilson.',
  'Modo gráfico: genera representaciones visuales de las curvas de costo para facilitar el análisis.',
  'Modo práctica: propone ejercicios nuevos, verifica respuestas y brinda correcciones detalladas.',
];

const troubleshooting = [
  'El chatbot no responde: verificá que la API Key haya sido copiada correctamente y que guardaste los cambios en Configuración.',
  'Aparece el error de cuota inmediatamente después de crear una nueva clave: confirmá que la key pertenezca a un proyecto diferente y que esté activa.',
];

export default function HelpModal({ onClose }: Props) {
  return (
    <div className="help-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="help-panel" role="dialog" aria-modal="true" aria-label="Guía de ayuda del Chatbot EOQ">
        <div className="help-header">
          <div>
            <p className="help-kicker">❓ Guía de ayuda</p>
            <h2>Chatbot EOQ</h2>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="help-body">
          <section className="help-section">
            <h3>¿Qué puede hacer este chatbot?</h3>
            <p>
              Este asistente está especializado en el Modelo de Wilson (EOQ) y puede ayudarte a calcular la Cantidad
              Económica de Pedido, aprender la teoría del modelo, generar gráficos de costos y practicar con ejercicios
              interactivos.
            </p>
            <div className="help-grid">
              <article>
                <h4>📐 Cálculo</h4>
                <p>Obtené el lote óptimo (q₀) y el Costo Total Esperado (CTE) a partir de tus propios datos.</p>
              </article>
              <article>
                <h4>📚 Teoría</h4>
                <p>Aprendé supuestos, formulación matemática e interpretación de resultados.</p>
              </article>
              <article>
                <h4>📊 Gráficos</h4>
                <p>Visualizá las curvas de costo de pedido, almacenamiento y costo total.</p>
              </article>
              <article>
                <h4>🧪 Práctica</h4>
                <p>Resolvé ejercicios paso a paso con verificación y retroalimentación.</p>
              </article>
            </div>
          </section>

          <section className="help-section">
            <h3>💡 Ejemplos de consultas</h3>
            <ul>
              {examples.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="help-section">
            <h3>📌 Datos necesarios para calcular el EOQ</h3>
            <ul>
              {requiredData.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p>
              Si falta algún dato, el chatbot intentará ayudarte a identificarlo o solicitará la información necesaria
              para continuar.
            </p>
          </section>

          <section className="help-section">
            <h3>🔑 Cómo crear tu API Key de Gemini</h3>
            <ol>
              <li>Ingresá a Google AI Studio con tu cuenta de Google.</li>
              <li>En el menú lateral, seleccioná Get API Key o Claves de API.</li>
              <li>Hacé clic en Create API Key y luego en Create API Key in New Project.</li>
              <li>Copiá la clave generada.</li>
              <li>Volvé al chatbot, abrí el panel de Configuración y pegá la clave.</li>
              <li>Guardá los cambios.</li>
            </ol>
            <p>Una vez configurada la API Key, el chatbot estará listo para utilizarse.</p>
          </section>

          <section className="help-section">
            <h3>🤖 Modelo recomendado</h3>
            <p>
              Se recomienda utilizar Gemini 3.5 Flash por su equilibrio entre velocidad, calidad de explicación,
              razonamiento y resolución de ejercicios matemáticos.
            </p>
          </section>

          <section className="help-section">
            <h3>⚠ Límites de uso de la API gratuita</h3>
            <p>
              Google establece límites de uso para las API gratuitas. Si aparece un mensaje de cuota alcanzada, no
              significa que exista un problema con el chatbot, sino que la cuota disponible para esa key o proyecto se
              agotó temporalmente.
            </p>
          </section>

          <section className="help-section">
            <h3>🚨 ¿Qué hacer si aparece el error “Límite de cuota alcanzado”?</h3>
            <ul>
              <li>Esperar al reinicio automático de la cuota.</li>
              <li>Crear una nueva API Key desde otro proyecto en Google AI Studio.</li>
              <li>Usar un plan pago de Google si necesitás más capacidad, aunque no suele ser necesario para un proyecto académico.</li>
            </ul>
          </section>

          <section className="help-section">
            <h3>🛠 Solución de problemas frecuentes</h3>
            <ul>
              {troubleshooting.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="help-section">
            <h3>📚 Modos de uso disponibles</h3>
            <ul>
              {usageModes.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="help-section">
            <h3>📞 Soporte</h3>
            <p>Si tenés dudas sobre el funcionamiento del chatbot o sobre el Modelo EOQ, consultá al equipo Solver Squad.</p>
          </section>
        </div>
      </div>
    </div>
  );
}