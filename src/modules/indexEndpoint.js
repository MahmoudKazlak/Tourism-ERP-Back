const roles = {
  Admin: "admin",
  Booking: "booking_staff",
  Accounting: "accounting_staff",
};

export const endpoint = {
  booking_manage: [roles.Admin, roles.Booking],
  booking_view: [roles.Admin, roles.Booking, roles.Accounting],
  booking_delete: [roles.Admin],

  provider_manage: [roles.Admin],
  provider_view: [roles.Admin, roles.Booking, roles.Accounting],

  accounting_only: [roles.Admin, roles.Accounting],

  AdminOnly: [roles.Admin],
  All: [roles.Admin, roles.Booking, roles.Accounting],
  view_logs: [roles.Admin],
};
