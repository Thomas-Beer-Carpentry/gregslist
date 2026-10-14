export type Ride = {
  id: string;
  post_id: string;
  driver_id: string;
  capacity: number;
  pickup: string;
  route: string;
  departure_at: string | null;
  timezone: string;
  return_available: boolean;
  return_departure_at: string | null;
  return_details: string | null;
  contribution_amount: number | null;
  contribution_currency: string;
  cost_notes: string | null;
  notes: string | null;
  status: string;
  needs_reconfirmation: boolean;
};
export type Reservation = {
  id: string;
  ride_id: string;
  passenger_id: string;
  created_by: string;
  status: string;
};
export type BookingReference = {
  id: string;
  ride_id: string;
  scope: "self" | "partner";
  manageable: boolean;
};
export type RideState = { error: string };
