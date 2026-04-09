import nodemailer from "nodemailer";

async function sendEmail(dest, subject, message) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SENDEREMAIL,
      pass: process.env.SENDEREMAILPASSWORD,
    },
  });

  const info = await transporter.sendMail({
    from: `"Inventory App" <${process.env.SENDEREMAIL}>`,
    to: dest,
    subject,
    html: message,
  });
  return info;
}
export default sendEmail;
