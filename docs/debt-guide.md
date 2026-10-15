# Guía de deudas: «¿Qué es esto?» y «Corregir datos»

Esta guía explica, para quien usa la app, dos ayudas de la pantalla de una deuda y cómo se corresponden con lo que hace Nia en Telegram. El detalle técnico está en [functions/nia/README.md](../functions/nia/README.md) y el orden de despliegue en [deploy.md](deploy.md).

## «¿Qué es esto?»

Junto a algunas cifras de la deuda aparece un botón con un signo de interrogación. Al tocarlo se abre una explicación corta del concepto con tus números:

| Cifra | Qué explica |
| --- | --- |
| Tasa | La tasa que registraste y su equivalente en E.A. y mensual |
| Mora acumulada, aviso de mora, mora en curso | Cómo se cobra la mora y cuánto llevas |
| Cargos y seguros | Qué cargos trae la cuota y cuánto suman en las próximas cuotas |
| Pago mínimo (tarjetas) | Qué es el pago mínimo y cuánto es el de tu último extracto |
| Último extracto (tarjetas) | Qué reúne el extracto, su corte y su fecha límite de pago |

Cómo se usa:

- En el celular, toca el botón; vuelve a tocarlo o toca fuera de la explicación para cerrarla.
- Con teclado, llega al botón con Tab, ábrelo con Enter o Espacio y ciérralo con Escape: el foco vuelve al botón.
- Es de solo lectura: abrirla no guarda ni cambia nada.
- Termina siempre con la fuente de los datos y el aviso «Información educativa con tus datos; no es asesoría financiera.». Una cifra marcada «aproximado» es una estimación.
- Es el mismo texto revisado que da Nia con «¿qué es la mora?». Si un tema todavía no tiene su texto revisado, el botón no aparece.

## «Corregir datos»

Sirve cuando un dato de la deuda estaba mal desde el inicio, por ejemplo el día de corte de una tarjeta, el día de pago, la regla del pago mínimo o la tasa tal como la dice el banco. No es para un cambio real (por ejemplo, que el banco bajó la tasa): para eso están **Cambiar tasa** y **Cambiar seguros y cargos**.

1. Abre la deuda y toca **Más acciones → Corregir datos**.
2. Cambia el dato y revisa la vista previa: muestra el antes y el después, y si algún pago anterior cambia de costo.
3. Confirma. La corrección se aplica desde el inicio de la deuda, sin tocar los pagos ya registrados, y queda en el historial.

Para deshacerla, anúlala desde el historial. En Telegram se hace con una frase como “el corte de la tarjeta es el 20, no el 15”: Nia muestra el mismo antes y después y guarda solo cuando confirmas. Si no está claro si el dato estaba mal o cambió de verdad, Nia lo pregunta con botones.
