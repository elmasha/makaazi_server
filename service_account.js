// {
//   "type": "service_account",
//   "project_id": "makaazi-5d6aa",
//   "private_key_id": "4fee36a32eeb120957e5a1440e0e24b0b0e1e471",
//   "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCyR4TF4WYiVpoq\njru/eBYPGEcop1RHn2KJ1mTSN+uvhNASoKGdFPfp0zy4OjUMm5lLwhJAefnXZsj9\nKceEWcNiVQKLtFsVH15dA+p5jatsXIde7knlQyEsf+nKJ17eUtm7w0t9f3U+ADtf\nfZWV9VyucuviNXr2tL63uJikvwRZMDjvW4j3+HPdqSlOcJaXwBy+BqGkYv2kx06a\n2vN6F4fEmFcF5ZEOgiSHjy6utjYyyqMjgDb+7JKLlkapdVjK/r5Zdw298U2AUNJb\nZEnvcDRMVDFZf3IwuPLqJBAHfNnSpIvfnj6/XPBsC001RrmZdUUyT2efM1Fvqgtc\nvvI3APAXAgMBAAECggEAUnJIsMqAVTj/qta/dNiwOuLbZa2ciFLpWx1PGvjJgi5F\nm5e1pdNgoz4RQpGInwAGcMabcj32kOrz4EBGCKsKdJsjxj/uL2KGXTXGZdhigoZ4\nBCrm+aOF3/J3yAlVEjP2haLXcn5TVgz9aDfHycXiyrpS5BYfe6Ay4vv3e5jrBeNF\nLTsHCoE3AYQ861+2w/yCObIfH4xMZ9v6YCeUkg9vv6eaxcp6n4PJjzWnXPvC464E\nsMCRf5/1VLbmBhcnIbYFaEHoggLG9+IC9adhDRH41mJL5U56jNpdRoMtbH/hBulA\n7MLlceIJ2qYyhrAskX9uuAHrcugSeYdIHJYl6gfSoQKBgQDkBmGrHtdxAcLMJZYx\nQtuaa4XG2wD8ZMGmCeP4vEHupePf3DqOQbLzeL0HwSSjgyCpPFtP3r1q7jHR5dNW\n4D0tckL8b1r54mNGd3zm/zGPgOdImPxB+VjXyYRL/ntnbNn2WolMBSyE0Mnq/zLW\n3Zh2lXwu3YzA3HpzHpIyNHkeywKBgQDIJsUOWkI14yL0y+a1tk4bWzeh6PG7nWeW\nJsqLTMjptVSXwUHdLco3SHedzN7pSR1JRxZJvyvEnWP1wKZSY5m9PtnrOvacGaVJ\neAmoKcHr+s0lxhExrL3puWcSl2eSCC7/sZSB1xS3uLd9vV6gqszkTuh6XN6je1oE\nQmEHxVQeZQKBgF21davyZ82MULa+96NU+5TRfU/ErvoKmj6XL/YHv/zIdgaIphPS\nUi2Wv/CQ4nLEL8b9A/Wl7ygjrZu6HIlGbD3iCD9fr/6jl/Lcphr0YzS7X9FI9dpT\nE7zSlyj381UEuepxOJ1iPvJyL5kAua7tsHuDYV6NNAwKT9RBiwlQ4TnTAoGBAJf6\nMFjkmi/Wx30/snA5/HbzPXv4qE0AiV5PGC7L4CbtpE0S1pM+qLRvlzxACubyuIUi\nsD7RJUfHBtbdMK2QqXU0Wz4taIJBSutNdW+2PWSU7N8I1Zd1hkMJn8VTJ7aP9jf7\nPDuW+ElEvjeA6nBvIOMfM5FuITPbfw+K46iF4oitAoGAW2SEA+ScXev2iAZ4eSOT\njyE4M6/Nb/XLWxqjGDXb6wkBCz82QiW5xl+KXpZH4dpZTD4FkqrMcrXc/mz8b3kZ\nW6bEAwa+H5UVB8UxVIUOEcyoss48KyWRlJhlhczoyuV59YONpAVu3NuHcrlFM3pW\nkJD8sZDvoKfQRF8TUq0paJU=\n-----END PRIVATE KEY-----\n",
//   "client_email": "firebase-adminsdk-fbsvc@makaazi-5d6aa.iam.gserviceaccount.com",
//   "client_id": "108510537290820150186",
//   "auth_uri": "https://accounts.google.com/o/oauth2/auth",
//   "token_uri": "https://oauth2.googleapis.com/token",
//   "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
//   "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40makaazi-5d6aa.iam.gserviceaccount.com",
//   "universe_domain": "googleapis.com"
// }
require('dotenv').config(); // Load .env variables

const serviceAccount = {
  type: "service_account",
  project_id: process.env.PROJECT_ID,
  private_key_id: process.env.PRIVATE_KEY_ID,
  private_key: process.env.PRIVATE_KEY.replace(/\\n/g, '\n'), // <-- fixes formatting
  client_email: process.env.CLIENT_EMAIL,
  client_id: process.env.CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
  universe_domain: "googleapis.com"
};

module.exports = serviceAccount;