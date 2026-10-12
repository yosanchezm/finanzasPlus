export const readableError = (error) => {
  if (!error) return 'Ocurrió un error inesperado.';
  if (error.code === 401) return 'La sesión no es válida o Appwrite rechazó el acceso.';
  if (error.code === 403) return 'Tu usuario no tiene acceso a este hogar. Revisa la membresía del Team.';
  if (error.code === 404) return 'No se encontró el hogar configurado en Appwrite.';
  return error.message || 'Ocurrió un error inesperado.';
};
